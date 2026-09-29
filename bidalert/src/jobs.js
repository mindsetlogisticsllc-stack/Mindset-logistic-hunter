"use strict";

const config = require("./config");
const db = require("./db");
const sam = require("./sam");
const { rankMatches } = require("./match");
const { emailConfigured, sendEmail, renderDigest } = require("./email");
const { LIVE_STATUSES } = require("./billing");

// Look back a few days so a missed run (outage, weekend deploy) still
// delivers; sent_alerts keeps anyone from getting the same notice twice.
const LOOKBACK_DAYS = 3;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function yesterday(now = new Date()) {
  return isoDate(new Date(now.getTime() - 86400000));
}

async function saveOpportunities(opportunities) {
  let saved = 0;

  for (const o of opportunities) {
    await db.query(
      `INSERT INTO opportunities (
         notice_id, title, solicitation_number, agency, naics_code, psc_code, notice_type,
         set_aside_code, set_aside, posted_date, response_deadline, state, city, ui_link, raw
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (notice_id) DO UPDATE SET
         title=EXCLUDED.title, response_deadline=EXCLUDED.response_deadline,
         set_aside_code=EXCLUDED.set_aside_code, set_aside=EXCLUDED.set_aside,
         raw=EXCLUDED.raw, ingested_at=NOW()`,
      [
        o.notice_id, o.title, o.solicitation_number, o.agency, o.naics_code, o.psc_code,
        o.notice_type, o.set_aside_code, o.set_aside, o.posted_date, o.response_deadline,
        o.state, o.city, o.ui_link, o.raw
      ]
    );
    saved += 1;
  }

  return saved;
}

async function ingest(date, fetchImpl) {
  const opportunities = await sam.fetchPostedOn(date, fetchImpl);
  const saved = await saveOpportunities(opportunities);
  console.log(`Ingested ${saved} biddable SAM.gov notices posted ${date}.`);
  return saved;
}

async function recentOpportunities(days, now = new Date()) {
  const result = await db.query(
    `SELECT * FROM opportunities
     WHERE posted_date >= $1
       AND (response_deadline IS NULL OR response_deadline > NOW())
     ORDER BY posted_date DESC`,
    [isoDate(new Date(now.getTime() - days * 86400000))]
  );

  return result.rows;
}

function hasCriteria(profile) {
  return (profile.naics_codes || []).length > 0 || (profile.keywords || []).length > 0;
}

async function sendDigests(date, now = new Date()) {
  if (!emailConfigured()) {
    throw new Error("Email is not configured (RESEND_API_KEY and EMAIL_FROM)");
  }

  const candidates = await recentOpportunities(LOOKBACK_DAYS, now);

  const recipients = await db.query(
    `SELECT u.id, u.email, p.*
     FROM users u
     JOIN profiles p ON p.user_id = u.id
     JOIN subscriptions s ON s.user_id = u.id
     WHERE p.email_enabled AND s.status = ANY($1)`,
    [LIVE_STATUSES]
  );

  let sent = 0;
  let failed = 0;

  for (const recipient of recipients.rows) {
    if (!hasCriteria(recipient)) {
      continue;
    }

    try {
      const already = await db.query(`SELECT notice_id FROM sent_alerts WHERE user_id=$1`, [recipient.id]);
      const alreadySent = new Set(already.rows.map((row) => row.notice_id));

      const matches = rankMatches(
        candidates.filter((o) => !alreadySent.has(o.notice_id)),
        recipient,
        config.MAX_ALERTS_PER_EMAIL,
        now
      );

      if (!matches.length) {
        continue;
      }

      const unsubscribeUrl = `${config.PUBLIC_URL}/unsubscribe/${recipient.unsubscribe_token}`;
      const email = renderDigest({ profile: recipient, matches, date, unsubscribeUrl });

      await sendEmail({ to: recipient.email, unsubscribeUrl, ...email });

      for (const match of matches) {
        await db.query(
          `INSERT INTO sent_alerts (user_id, notice_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [recipient.id, match.notice_id]
        );
      }

      sent += 1;
    } catch (err) {
      failed += 1;
      console.error(`Digest for ${recipient.email} failed:`, err.message);
    }
  }

  console.log(`Digests for ${date}: ${sent} sent, ${failed} failed.`);
  return { sent, failed };
}

/*
  Runs at most once per day. A failed run can be retried on the next tick;
  a run stuck in "running" for over an hour (e.g. the server restarted
  mid-run) is also retried.
*/
async function claimRun(runDate) {
  const inserted = await db.query(
    `INSERT INTO job_runs (job, run_date, status) VALUES ('daily', $1, 'running')
     ON CONFLICT DO NOTHING RETURNING run_date`,
    [runDate]
  );

  if (inserted.rows.length) {
    return true;
  }

  const retried = await db.query(
    `UPDATE job_runs SET status='running', started_at=NOW(), detail=NULL
     WHERE job='daily' AND run_date=$1
       AND (status='failed' OR (status='running' AND started_at < NOW() - INTERVAL '1 hour'))
     RETURNING run_date`,
    [runDate]
  );

  return retried.rows.length > 0;
}

async function runDaily({ now = new Date(), force = false, fetchImpl } = {}) {
  const runDate = isoDate(now);
  const postedDate = yesterday(now);

  if (force) {
    await db.query(`DELETE FROM job_runs WHERE job='daily' AND run_date=$1`, [runDate]);
  }

  if (!(await claimRun(runDate))) {
    return { skipped: true };
  }

  try {
    const ingested = await ingest(postedDate, fetchImpl);
    const digests = await sendDigests(postedDate, now);
    const detail = `ingested ${ingested}; emails sent ${digests.sent}, failed ${digests.failed}`;

    await db.query(
      `UPDATE job_runs SET status='done', detail=$2, finished_at=NOW() WHERE job='daily' AND run_date=$1`,
      [runDate, detail]
    );

    return { ingested, ...digests };
  } catch (err) {
    console.error("Daily run failed:", err.message);

    await db.query(
      `UPDATE job_runs SET status='failed', detail=$2, finished_at=NOW() WHERE job='daily' AND run_date=$1`,
      [runDate, err.message.slice(0, 500)]
    );

    return { error: err.message };
  }
}

function startScheduler() {
  const tick = () => {
    if (!db.isReady() || new Date().getUTCHours() < config.DIGEST_HOUR_UTC) {
      return;
    }

    runDaily().catch((err) => console.error("Scheduler error:", err.message));
  };

  setTimeout(tick, 30000);
  return setInterval(tick, 10 * 60 * 1000);
}

module.exports = {
  ingest,
  sendDigests,
  runDaily,
  recentOpportunities,
  startScheduler,
  yesterday
};
