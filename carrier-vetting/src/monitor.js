"use strict";

const config = require("./config");
const db = require("./db");
const fmcsa = require("./fmcsa");
const { LIVE_STATUSES } = require("./billing");
const { emailConfigured, sendEmail, renderChangeAlert } = require("./email");

/*
  What we watch on a saved carrier. serious = something that should stop
  the next load (authority pulled, insurance dropped, put out of service).
*/
const WATCHED = [
  { label: "Allowed to operate", get: (s) => (s.allowed_to_operate == null ? "unknown" : s.allowed_to_operate ? "Yes" : "No"), serious: (b, a) => a === "No" },
  { label: "USDOT status", get: (s) => s.status_code || "unknown", serious: (b, a) => a !== "A" },
  { label: "Common authority", get: (s) => s.common_authority, serious: (b, a) => b === "Active" && a !== "Active" },
  { label: "Contract authority", get: (s) => s.contract_authority, serious: (b, a) => b === "Active" && a !== "Active" },
  { label: "Liability insurance on file ($K)", get: (s) => String(s.insurance?.bipd_on_file ?? 0), serious: (b, a) => Number(a) < Number(b) },
  { label: "Cargo insurance on file ($K)", get: (s) => String(s.insurance?.cargo_on_file ?? 0), serious: (b, a) => Number(a) < Number(b) },
  { label: "Out-of-service order", get: (s) => (s.oos_date || (s.out_of_service || []).length ? "Yes" : "No"), serious: (b, a) => a === "Yes" },
  { label: "Safety rating", get: (s) => s.safety_rating || "Not rated", serious: (b, a) => a === "Unsatisfactory" || a === "Conditional" },
  {
    label: "Safety alerts (BASICs)",
    get: (s) => (s.basics || []).filter((x) => x.alert).map((x) => x.name).sort().join(", ") || "None",
    serious: (b, a) => a !== "None" && a.split(", ").length > (b === "None" ? 0 : b.split(", ").length)
  },
  { label: "Legal name", get: (s) => s.legal_name || "", serious: () => true },
  { label: "Address", get: (s) => [s.address?.street, s.address?.city, s.address?.state].filter(Boolean).join(", "), serious: () => false }
];

function diff(before, after) {
  if (!before || !after) {
    return [];
  }

  return WATCHED.map((w) => {
    const b = w.get(before);
    const a = w.get(after);
    return b === a ? null : { label: w.label, before: b, after: a, serious: Boolean(w.serious(b, a)) };
  }).filter(Boolean);
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

async function claimRun(runDate) {
  const inserted = await db.query(
    `INSERT INTO job_runs (job, run_date, status) VALUES ('monitor', $1, 'running')
     ON CONFLICT DO NOTHING RETURNING run_date`,
    [runDate]
  );

  if (inserted.rows.length) {
    return true;
  }

  const retried = await db.query(
    `UPDATE job_runs SET status='running', started_at=NOW(), detail=NULL
     WHERE job='monitor' AND run_date=$1
       AND ((status='failed' AND finished_at < NOW() - INTERVAL '1 hour')
         OR (status='running' AND started_at < NOW() - INTERVAL '2 hours'))
     RETURNING run_date`,
    [runDate]
  );

  return retried.rows.length > 0;
}

/*
  Re-fetch every carrier on any paying customer's watchlist once (shared
  across customers watching the same carrier), record changes, and email
  each customer one summary.
*/
async function runMonitor({ now = new Date(), force = false, fetchImpl } = {}) {
  const runDate = isoDate(now);

  if (!fmcsa.configured()) {
    return { skipped: "FMCSA_WEB_KEY not configured" };
  }

  if (force) {
    await db.query(`DELETE FROM job_runs WHERE job='monitor' AND run_date=$1`, [runDate]);
  }

  if (!(await claimRun(runDate))) {
    return { skipped: true };
  }

  try {
    const watched = await db.query(
      `SELECT w.user_id, w.dot_number, w.legal_name, w.last_snapshot
       FROM watchlist w JOIN subscriptions s ON s.user_id = w.user_id
       WHERE s.status = ANY($1)`,
      [LIVE_STATUSES]
    );

    const fresh = new Map();
    let checked = 0;
    let changed = 0;

    for (const row of watched.rows) {
      if (!fresh.has(row.dot_number)) {
        try {
          fresh.set(row.dot_number, await fmcsa.lookup({ kind: "dot", number: row.dot_number }, fetchImpl));
        } catch (err) {
          console.error(`Monitor lookup ${row.dot_number} failed:`, err.message);
          fresh.set(row.dot_number, undefined);
        }

        // Be gentle with FMCSA's free API.
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      const snapshot = fresh.get(row.dot_number);

      if (!snapshot) {
        continue;
      }

      checked += 1;
      const items = diff(row.last_snapshot, snapshot);

      if (items.length) {
        changed += 1;
        await db.query(`INSERT INTO watch_changes (user_id, dot_number, changes) VALUES ($1,$2,$3)`, [
          row.user_id,
          row.dot_number,
          JSON.stringify(items)
        ]);
      }

      await db.query(
        `UPDATE watchlist SET last_snapshot=$3, legal_name=$4, last_checked_at=NOW() WHERE user_id=$1 AND dot_number=$2`,
        [row.user_id, row.dot_number, JSON.stringify(snapshot), snapshot.legal_name]
      );
    }

    const emails = await sendChangeEmails();
    const detail = `checked ${checked}; changed ${changed}; emails sent ${emails.sent}, failed ${emails.failed}`;

    await db.query(`UPDATE job_runs SET status='done', detail=$2, finished_at=NOW() WHERE job='monitor' AND run_date=$1`, [runDate, detail]);
    console.log(`Monitor ${runDate}: ${detail}`);
    return { checked, changed, ...emails };
  } catch (err) {
    console.error("Monitor failed:", err.message);
    await db.query(`UPDATE job_runs SET status='failed', detail=$2, finished_at=NOW() WHERE job='monitor' AND run_date=$1`, [
      runDate,
      err.message.slice(0, 500)
    ]);
    return { error: err.message };
  }
}

async function sendChangeEmails() {
  if (!emailConfigured()) {
    return { sent: 0, failed: 0, skipped: "email not configured" };
  }

  const pending = await db.query(
    `SELECT c.id, c.user_id, c.dot_number, c.changes, w.legal_name, u.email, p.unsubscribe_token
     FROM watch_changes c
     JOIN users u ON u.id = c.user_id
     JOIN profiles p ON p.user_id = c.user_id
     LEFT JOIN watchlist w ON w.user_id = c.user_id AND w.dot_number = c.dot_number
     WHERE NOT c.emailed AND p.alerts_enabled
     ORDER BY c.user_id, c.detected_at`
  );

  const byUser = new Map();

  for (const row of pending.rows) {
    if (!byUser.has(row.user_id)) {
      byUser.set(row.user_id, { email: row.email, token: row.unsubscribe_token, ids: [], changes: [] });
    }

    const entry = byUser.get(row.user_id);
    entry.ids.push(row.id);
    entry.changes.push({ dot_number: row.dot_number, legal_name: row.legal_name, items: row.changes });
  }

  let sent = 0;
  let failed = 0;

  for (const entry of byUser.values()) {
    try {
      const unsubscribeUrl = `${config.PUBLIC_URL}/unsubscribe/${entry.token}`;
      await sendEmail({ to: entry.email, unsubscribeUrl, ...renderChangeAlert({ changes: entry.changes, unsubscribeUrl }) });
      await db.query(`UPDATE watch_changes SET emailed=TRUE WHERE id = ANY($1)`, [entry.ids]);
      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`Change alert to ${entry.email} failed:`, err.message);
    }
  }

  return { sent, failed };
}

function startScheduler() {
  const tick = () => {
    if (!db.isReady() || new Date().getUTCHours() < config.MONITOR_HOUR_UTC) {
      return;
    }

    runMonitor().catch((err) => console.error("Scheduler error:", err.message));
  };

  setTimeout(tick, 30000);
  return setInterval(tick, 10 * 60 * 1000);
}

module.exports = { diff, runMonitor, startScheduler };
