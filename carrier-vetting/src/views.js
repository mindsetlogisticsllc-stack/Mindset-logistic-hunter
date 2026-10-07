"use strict";

const config = require("./config");
const { escapeHtml } = require("./html");

const CSS = `
  :root { --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --bg:#f8fafc; --accent:#1d4ed8;
          --good:#047857; --goodbg:#ecfdf5; --warn:#b45309; --warnbg:#fffbeb; --bad:#b91c1c; --badbg:#fef2f2; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--ink); background:var(--bg); line-height:1.5; }
  a { color:var(--accent); }
  header { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; max-width:980px; margin:0 auto; gap:12px; flex-wrap:wrap; }
  header .brand { font-weight:800; font-size:20px; color:var(--ink); text-decoration:none; }
  header nav { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
  header nav a { text-decoration:none; font-weight:600; }
  main { max-width:980px; margin:0 auto; padding:0 16px 48px; }
  .hero { padding:36px 0 20px; }
  .hero h1 { font-size:clamp(28px,6vw,46px); line-height:1.1; margin:0 0 14px; }
  .hero p { font-size:18px; color:var(--muted); max-width:640px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin:16px 0; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
  .btn { display:inline-block; background:var(--ink); color:#fff; border:0; border-radius:10px; padding:12px 18px; font-size:16px; font-weight:600; text-decoration:none; cursor:pointer; }
  .btn.secondary { background:#fff; color:var(--ink); border:1px solid var(--line); }
  .btn.small { padding:7px 12px; font-size:14px; }
  .btn.block { width:100%; text-align:center; }
  label { display:block; font-weight:600; margin:14px 0 6px; }
  input[type=email], input[type=password], input[type=text] { width:100%; padding:11px 12px; border:1px solid #cbd5e1; border-radius:10px; font-size:16px; font-family:inherit; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
  .row > div { flex:1 1 220px; }
  .hint, .meta { color:var(--muted); font-size:14px; }
  .notice { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px 14px; margin:12px 0; }
  .notice.warn { background:var(--warnbg); border-color:#fde68a; }
  .notice.good { background:var(--goodbg); border-color:#a7f3d0; }
  .verdict { border-radius:14px; padding:18px 20px; margin:16px 0; border:1px solid; }
  .verdict h2 { margin:0 0 4px; font-size:26px; }
  .approve { background:var(--goodbg); border-color:#a7f3d0; color:var(--good); }
  .review { background:var(--warnbg); border-color:#fde68a; color:var(--warn); }
  .reject { background:var(--badbg); border-color:#fecaca; color:var(--bad); }
  .flags { list-style:none; padding:0; margin:0; }
  .flags li { padding:10px 0; border-bottom:1px solid var(--line); }
  .flags li:last-child { border-bottom:0; }
  .tag { display:inline-block; font-size:12px; font-weight:700; border-radius:999px; padding:2px 8px; margin-right:8px; text-transform:uppercase; }
  .tag.reject { border:0; } .tag.review { border:0; } .tag.info, .tag.approve { background:var(--goodbg); color:var(--good); }
  table { width:100%; border-collapse:collapse; font-size:15px; }
  td, th { text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--muted); font-weight:600; width:42%; }
  .scroll { overflow-x:auto; }
  .price { font-size:36px; font-weight:800; }
  .form { max-width:440px; margin:24px auto; }
  .mono { font-family:ui-monospace,Menlo,Consolas,monospace; font-size:13px; word-break:break-all; }
  footer { max-width:980px; margin:0 auto; padding:24px 16px; color:var(--muted); font-size:13px; }
  @media print { header nav, footer, .noprint { display:none !important; } body { background:#fff; } .card { border:0; padding:0; } }
`;

const DECISION = {
  approve: { label: "Approve", icon: "✅", text: "No problems found in FMCSA records." },
  review: { label: "Review first", icon: "⚠️", text: "Check the items below before you tender a load." },
  reject: { label: "Do not use", icon: "❌", text: "This carrier failed a required check." }
};

function page(title, body, { user = null } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(config.APP_NAME)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <a class="brand" href="/">${escapeHtml(config.APP_NAME)}</a>
  <nav>
    ${
      user
        ? `<a href="/dashboard">Dashboard</a>
           <form method="POST" action="/logout" style="display:inline"><button class="btn secondary small">Log out</button></form>`
        : `<a href="/login">Log in</a><a class="btn small" href="/signup">Start free</a>`
    }
  </nav>
</header>
<main>${body}</main>
<footer>
  © ${new Date().getFullYear()} ${escapeHtml(config.COMPANY_NAME)}. All rights reserved. ·
  <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
  ${config.SUPPORT_EMAIL ? ` · <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a>` : ""}
  <br>Carrier data comes from the FMCSA. Not affiliated with the FMCSA or the U.S. Department of Transportation.
  Results support, but do not replace, your own judgment.
</footer>
</body>
</html>`;
}

function simple(title, html, opts) {
  return page(title, `<div class="card" style="margin-top:24px"><h1 style="margin-top:0">${escapeHtml(title)}</h1>${html}</div>`, opts);
}

function landing({ user }) {
  return page(
    "Carrier vetting for freight brokers",
    `
    <section class="hero">
      <h1>Vet every carrier in seconds. Keep the proof.</h1>
      <p>Enter an MC or USDOT number and get a clear ✅ / ⚠️ / ❌ from live FMCSA data: authority, insurance,
      out-of-service orders, safety alerts and common fraud signals. Every check is saved as a timestamped
      record you can show your insurer or attorney.</p>
      <a class="btn" href="${user ? "/dashboard" : "/signup"}">Run a free check</a>
    </section>

    <div class="notice warn">
      <strong>Why it matters now:</strong> in <em>Montgomery v. Caribe Transport</em> (May 2026) the U.S. Supreme Court
      held that brokers can be sued for negligently selecting a carrier. Brokers who can show they checked carefully
      are in a far better position.
    </div>

    <div class="grid">
      <div class="card"><h3>Instant decision</h3><p class="meta">Authority, insurance on file, out-of-service orders, safety rating and BASIC alerts, scored with plain-English reasons.</p></div>
      <div class="card"><h3>Fraud red flags</h3><p class="meta">Broker-only authority (double-brokering risk), no inspection history, zero trucks, outdated registration.</p></div>
      <div class="card"><h3>Proof of due diligence</h3><p class="meta">Each check becomes a tamper-evident record with the data you relied on, the load reference and who checked.</p></div>
      <div class="card"><h3>Daily monitoring</h3><p class="meta">Watch your carriers. We email you when authority, insurance or safety status changes.</p></div>
    </div>

    <div class="card" style="max-width:440px">
      <div class="price">${escapeHtml(config.PRICE_LABEL)}</div>
      <p class="meta">Unlimited checks, proof records and daily monitoring. ${config.FREE_LOOKUPS_PER_MONTH} free checks a month without a subscription.
      ${config.TRIAL_DAYS > 0 ? `${config.TRIAL_DAYS}-day free trial.` : ""} Cancel anytime.</p>
      <a class="btn block" href="${user ? "/dashboard" : "/signup"}">Get started</a>
    </div>
    `,
    { user }
  );
}

function authForm({ mode, error = "", email = "" }) {
  const signup = mode === "signup";

  return page(
    signup ? "Create account" : "Log in",
    `
    <div class="form card">
      <h1 style="margin-top:0">${signup ? "Create your account" : "Welcome back"}</h1>
      ${error ? `<div class="notice warn">${escapeHtml(error)}</div>` : ""}
      <form method="POST" action="/${signup ? "signup" : "login"}">
        <label>Email</label>
        <input type="email" name="email" required autocomplete="email" value="${escapeHtml(email)}">
        <label>Password</label>
        <input type="password" name="password" required minlength="8" autocomplete="${signup ? "new-password" : "current-password"}"
          ${signup ? 'placeholder="At least 8 characters"' : ""}>
        ${
          signup
            ? `<label>Confirm password</label>
               <input type="password" name="password_confirm" required minlength="8" autocomplete="new-password">`
            : ""
        }
        <p style="margin-top:20px"><button class="btn block">${signup ? "Create account" : "Log in"}</button></p>
      </form>
      <p class="hint">${signup ? `Already have an account? <a href="/login">Log in</a>` : `New here? <a href="/signup">Create an account</a>`}</p>
    </div>
    `
  );
}

function decisionBox(decision) {
  const d = DECISION[decision] || DECISION.review;
  return `<div class="verdict ${escapeHtml(decision)}"><h2>${d.icon} ${escapeHtml(d.label)}</h2><div>${escapeHtml(d.text)}</div></div>`;
}

function flagList(flags) {
  return `<ul class="flags">${(flags || [])
    .map((f) => `<li><span class="tag ${escapeHtml(f.level)}">${escapeHtml(f.level === "info" ? "ok" : f.level)}</span>${escapeHtml(f.text)}</li>`)
    .join("")}</ul>`;
}

function snapshotTable(s) {
  if (!s) {
    return "";
  }

  const ins = s.insurance || {};
  const row = (k, v) => `<tr><th>${escapeHtml(k)}</th><td>${v}</td></tr>`;
  const t = (v) => escapeHtml(v == null || v === "" ? "—" : v);

  return `<div class="scroll"><table>
    ${row("Legal name", t(s.legal_name))}
    ${s.dba_name ? row("DBA", t(s.dba_name)) : ""}
    ${row("USDOT", t(s.dot_number))}
    ${row("Docket(s)", t((s.dockets || []).map((d) => `${d.prefix}-${d.number}`).join(", ")))}
    ${row("Allowed to operate", t(s.allowed_to_operate == null ? null : s.allowed_to_operate ? "Yes" : "No"))}
    ${row("Common / contract authority", t(`${s.common_authority} / ${s.contract_authority}`))}
    ${row("Broker authority", t(s.broker_authority))}
    ${row("Liability (BIPD) on file", t(ins.bipd_on_file ? `$${Number(ins.bipd_on_file).toLocaleString()}K` : "None"))}
    ${row("Cargo insurance on file", t(ins.cargo_on_file ? `$${Number(ins.cargo_on_file).toLocaleString()}K` : ins.cargo_required ? "None (required)" : "None"))}
    ${row("Safety rating", t(s.safety_rating || "Not rated"))}
    ${row("Out-of-service order", t(s.oos_date || (s.out_of_service || []).length ? "Yes" : "No"))}
    ${row("Safety alerts (BASICs)", t((s.basics || []).filter((b) => b.alert).map((b) => b.name).join(", ") || "None"))}
    ${row("Inspections / crashes (24 mo)", t(`${s.inspections} / ${s.crashes}`))}
    ${row("Vehicle OOS rate (national avg)", t(s.vehicle_oos_rate == null ? null : `${s.vehicle_oos_rate}% (${s.vehicle_oos_national ?? "?"}%)`))}
    ${row("Power units / drivers", t(`${s.power_units ?? "?"} / ${s.drivers ?? "?"}`))}
    ${row("Physical address", t([s.address?.street, s.address?.city, s.address?.state, s.address?.zip].filter(Boolean).join(", ")))}
    ${row("Data fetched", t(s.fetched_at ? new Date(s.fetched_at).toUTCString() : null))}
  </table></div>`;
}

function dashboard({ user, access, subscription, usage, vettings, watchlist, flash, billingReady, fmcsaReady, error = "", q = "" }) {
  const plan = access
    ? `<div class="notice good">${subscription.status === "trialing" ? "Free trial active." : "Subscription active."}
         Unlimited checks and monitoring. <a href="/billing/portal">Manage billing</a></div>`
    : `<div class="notice">Free plan: ${usage.used} of ${config.FREE_LOOKUPS_PER_MONTH} checks used this month. Monitoring needs a subscription.
         ${
           billingReady
             ? `<form method="POST" action="/billing/checkout" style="margin-top:8px"><button class="btn small">Upgrade, ${escapeHtml(config.PRICE_LABEL)}</button></form>`
             : ""
         }
         ${subscription.stripe_customer_id ? `<div style="margin-top:6px"><a href="/billing/portal">Manage billing</a></div>` : ""}
       </div>`;

  const history = vettings.length
    ? `<div class="scroll"><table>
        <tr><th style="width:auto">When</th><th style="width:auto">Carrier</th><th style="width:auto">Load</th><th style="width:auto">Decision</th></tr>
        ${vettings
          .map(
            (v) => `<tr>
              <td>${escapeHtml(new Date(v.created_at).toLocaleString("en-US", { timeZone: "America/Chicago" }))}</td>
              <td><a href="/records/${escapeHtml(v.id)}">${escapeHtml(v.legal_name || v.dot_number)}</a><div class="meta">USDOT ${escapeHtml(v.dot_number)}</div></td>
              <td>${escapeHtml(v.load_reference || "—")}</td>
              <td>${DECISION[v.decision]?.icon || ""} ${escapeHtml(DECISION[v.decision]?.label || v.decision)}</td>
            </tr>`
          )
          .join("")}
      </table></div>`
    : `<p class="meta">No checks yet. Run your first one above.</p>`;

  const watched = watchlist.length
    ? `<div class="scroll"><table>
        ${watchlist
          .map(
            (w) => `<tr>
              <td><strong>${escapeHtml(w.legal_name || w.dot_number)}</strong><div class="meta">USDOT ${escapeHtml(w.dot_number)} · last checked ${escapeHtml(w.last_checked_at ? new Date(w.last_checked_at).toLocaleDateString("en-US") : "pending")}</div></td>
              <td style="text-align:right"><form method="POST" action="/watch/${escapeHtml(w.dot_number)}/remove"><button class="btn secondary small">Stop watching</button></form></td>
            </tr>`
          )
          .join("")}
      </table></div>`
    : `<p class="meta">Not watching any carriers. Use “Watch daily” on a check result.</p>`;

  return page(
    "Dashboard",
    `
    <h1>Carrier checks</h1>
    ${flash ? `<div class="notice good">${escapeHtml(flash)}</div>` : ""}
    ${error ? `<div class="notice warn">${escapeHtml(error)}</div>` : ""}
    ${fmcsaReady ? "" : `<div class="notice warn">Carrier lookups are being set up (FMCSA key not configured yet).</div>`}
    ${plan}

    <div class="card">
      <form method="POST" action="/check">
        <div class="row">
          <div><label>MC or USDOT number</label><input type="text" name="q" required placeholder="MC-123456 or 1234567" value="${escapeHtml(q)}"></div>
          <div><label>Load / reference # <span class="hint">(optional)</span></label><input type="text" name="load" maxlength="80" placeholder="e.g. Load 4471"></div>
          <div style="flex:0 0 auto"><button class="btn">Check carrier</button></div>
        </div>
        <p class="hint">Tip: start the number with “MC” for a docket number; plain digits are treated as a USDOT number.</p>
      </form>
    </div>

    <div class="card"><h2 style="margin-top:0">Watched carriers</h2>${watched}</div>
    <div class="card"><h2 style="margin-top:0">Recent checks</h2>${history}</div>
    `,
    { user }
  );
}

function recordPage({ user, record, valid, owner }) {
  const created = new Date(record.created_at);

  return page(
    `Vetting record ${record.legal_name || record.dot_number}`,
    `
    <div class="noprint" style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
      ${owner ? `<a class="btn secondary small" href="/dashboard">← Dashboard</a>` : ""}
      <button class="btn small" onclick="window.print()">Print / Save as PDF</button>
      ${
        owner
          ? `<form method="POST" action="/watch/${escapeHtml(record.dot_number)}"><button class="btn secondary small">Watch daily</button></form>`
          : ""
      }
    </div>

    <div class="card">
      <h1 style="margin:0">Carrier vetting record</h1>
      <p class="meta" style="margin:4px 0 0">${escapeHtml(config.APP_NAME)} · ${escapeHtml(config.COMPANY_NAME)}</p>

      ${decisionBox(record.decision)}

      <div class="scroll"><table>
        <tr><th>Checked at</th><td>${escapeHtml(created.toUTCString())}</td></tr>
        <tr><th>Load / reference</th><td>${escapeHtml(record.load_reference || "—")}</td></tr>
        <tr><th>Checked by</th><td>${escapeHtml(record.checked_by || "—")}</td></tr>
        <tr><th>Score</th><td>${escapeHtml(record.score)} / 100</td></tr>
      </table></div>

      <h3>Findings</h3>
      ${flagList(record.flags)}

      <h3>FMCSA data relied on</h3>
      ${snapshotTable(record.snapshot)}

      <h3>Record integrity</h3>
      <p class="meta">${
        valid
          ? "✅ Verified: this record has not been changed since it was created."
          : "❌ This record does not match its fingerprint and may have been altered."
      }</p>
      <p class="mono">Record ID: ${escapeHtml(record.id)}<br>SHA-256: ${escapeHtml(record.record_hash)}</p>
      <p class="meta">Verify anytime at ${escapeHtml(config.PUBLIC_URL || "")}/verify/${escapeHtml(record.id)}</p>
      <p class="meta">This record shows the FMCSA data available at the time of the check. It supports, but does not replace,
      the broker's own judgment and any additional verification (for example, calling the carrier at the phone number
      listed with FMCSA and confirming a certificate of insurance).</p>
    </div>
    `,
    { user }
  );
}

function terms() {
  return simple(
    "Terms of Service",
    `
    <p class="meta">Last updated October 7, 2026</p>
    <p>${escapeHtml(config.APP_NAME)} is operated by ${escapeHtml(config.COMPANY_NAME)}. By using it you agree to these terms.</p>
    <p><strong>What it does.</strong> We retrieve public carrier information from the FMCSA and apply automated checks to help you
    decide whether to use a motor carrier. Results are decision support only. FMCSA data can be incomplete or out of date, and
    automated checks cannot detect every fraud or safety risk.</p>
    <p><strong>Your responsibility.</strong> You alone decide which carriers to use and remain responsible for your carrier
    selection, contracts, insurance and compliance with law. We do not guarantee any carrier's safety, identity, insurance or performance.</p>
    <p><strong>Records.</strong> Vetting records show what data was available when you ran a check. Keep your own copies.</p>
    <p><strong>Not affiliated.</strong> We are not affiliated with the FMCSA or the U.S. Department of Transportation.</p>
    <p><strong>Billing.</strong> Paid plans renew monthly through Stripe until cancelled. Cancel anytime from Manage billing; you keep access
    until the end of the paid period. Fees already paid are not refunded except where required by law.</p>
    <p><strong>Acceptable use.</strong> Don't resell access, scrape the service or use it unlawfully.</p>
    <p><strong>Disclaimer and limitation of liability.</strong> The service is provided "as is" without warranties of any kind. To the fullest
    extent allowed by law, we are not liable for lost loads, cargo, profits, claims or any indirect or consequential damages, and our total
    liability is limited to the fees you paid in the three months before the claim.</p>
    <p><strong>Law.</strong> These terms are governed by the laws of Texas; disputes go to the courts of Dallas County, Texas.</p>
    ${config.SUPPORT_EMAIL ? `<p>Questions: <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a></p>` : ""}
    `
  );
}

function privacy() {
  return simple(
    "Privacy Policy",
    `
    <p class="meta">Last updated October 7, 2026</p>
    <p>We collect your email address, a securely hashed password, the carriers you check or watch, load references you enter, and
    billing status. We use them only to run your account, keep your vetting records and send monitoring alerts.</p>
    <p>Payments are handled by Stripe; we never see your card number. Emails are sent through Resend; the app is hosted on Railway.
    We don't sell your information.</p>
    <p>Vetting records are kept while your account is open so you can rely on them later. You can unsubscribe from alerts with the link
    in any email and ask us to delete your account${config.SUPPORT_EMAIL ? ` at <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a>` : ""}.</p>
    `
  );
}

module.exports = { page, simple, landing, authForm, dashboard, recordPage, terms, privacy, DECISION };
