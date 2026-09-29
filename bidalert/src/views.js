"use strict";

const config = require("./config");
const { escapeHtml } = require("./html");
const { CERTIFICATIONS } = require("./match");
const { formatDeadline } = require("./email");

const CSS = `
  :root { --ink:#111827; --muted:#4b5563; --line:#e5e7eb; --bg:#f9fafb; --accent:#1d4ed8; --good:#047857; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif; color:var(--ink); background:var(--bg); line-height:1.5; }
  a { color:var(--accent); }
  header { display:flex; justify-content:space-between; align-items:center; padding:14px 16px; max-width:960px; margin:0 auto; }
  header .brand { font-weight:800; font-size:20px; color:var(--ink); text-decoration:none; }
  header nav a { margin-left:14px; text-decoration:none; font-weight:600; }
  main { max-width:960px; margin:0 auto; padding:0 16px 48px; }
  .hero { padding:40px 0 24px; }
  .hero h1 { font-size:clamp(30px,6vw,48px); line-height:1.1; margin:0 0 14px; }
  .hero p { font-size:18px; color:var(--muted); max-width:620px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:14px; padding:20px; margin:16px 0; }
  .grid { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); }
  .btn { display:inline-block; background:var(--ink); color:#fff; border:0; border-radius:10px; padding:12px 18px; font-size:16px; font-weight:600; text-decoration:none; cursor:pointer; }
  .btn.secondary { background:#fff; color:var(--ink); border:1px solid var(--line); }
  .btn.block { width:100%; text-align:center; }
  label { display:block; font-weight:600; margin:14px 0 6px; }
  input[type=email], input[type=password], input[type=text], textarea { width:100%; padding:11px 12px; border:1px solid #d1d5db; border-radius:10px; font-size:16px; font-family:inherit; }
  textarea { min-height:80px; }
  .hint { color:var(--muted); font-size:14px; margin-top:4px; }
  .checks label { font-weight:400; display:flex; gap:8px; align-items:center; margin:6px 0; }
  .notice { background:#eff6ff; border:1px solid #bfdbfe; border-radius:10px; padding:12px 14px; margin:12px 0; }
  .notice.warn { background:#fffbeb; border-color:#fde68a; }
  .notice.good { background:#ecfdf5; border-color:#a7f3d0; }
  .opp { padding:14px 0; border-bottom:1px solid var(--line); }
  .opp:last-child { border-bottom:0; }
  .opp a.title { font-weight:600; color:var(--ink); text-decoration:none; font-size:16px; }
  .meta { color:var(--muted); font-size:14px; }
  .why { color:var(--good); font-size:13px; }
  .price { font-size:36px; font-weight:800; }
  .form { max-width:440px; margin:24px auto; }
  footer { max-width:960px; margin:0 auto; padding:24px 16px; color:var(--muted); font-size:13px; }
  .locked { filter:blur(4px); user-select:none; pointer-events:none; }
`;

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
           <form method="POST" action="/logout" style="display:inline"><button class="btn secondary" style="padding:6px 12px;margin-left:14px">Log out</button></form>`
        : `<a href="/login">Log in</a><a href="/signup">Start free trial</a>`
    }
  </nav>
</header>
<main>${body}</main>
<footer>
  © ${new Date().getFullYear()} ${escapeHtml(config.COMPANY_NAME)} ·
  <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
  ${config.SUPPORT_EMAIL ? ` · <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a>` : ""}
  <br>Not affiliated with SAM.gov or the U.S. government. Opportunity data is public information from SAM.gov.
</footer>
</body>
</html>`;
}

function landing({ user }) {
  return page(
    "Government contract alerts",
    `
    <section class="hero">
      <h1>New government contracts that fit your business, in your inbox every morning.</h1>
      <p>Tell us your NAICS codes, what you do and where you work. Every day we check every new
      federal opportunity on SAM.gov and email you only the ones worth a look, ranked best first.</p>
      <a class="btn" href="${user ? "/dashboard" : "/signup"}">Start your ${config.TRIAL_DAYS}-day free trial</a>
    </section>

    <div class="grid">
      <div class="card"><h3>Set it once</h3><p class="meta">Pick your NAICS codes, keywords, states and certifications (8(a), SDVOSB, WOSB, HUBZone…). Takes two minutes.</p></div>
      <div class="card"><h3>We read SAM.gov for you</h3><p class="meta">Thousands of notices a week. We skip award notices and anything reserved for a set-aside you don't hold.</p></div>
      <div class="card"><h3>One short email a day</h3><p class="meta">Only new matches, never repeats, with the agency, deadline, location and why it matched.</p></div>
    </div>

    <div class="card" style="max-width:420px">
      <div class="price">${escapeHtml(config.PRICE_LABEL)}</div>
      <p class="meta">${config.TRIAL_DAYS}-day free trial. Cancel anytime from your dashboard in two clicks.</p>
      <a class="btn block" href="${user ? "/dashboard" : "/signup"}">Get my first alerts</a>
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
               <input type="password" name="password_confirm" required minlength="8" autocomplete="new-password" placeholder="Type it again">
               <p class="hint">By creating an account you agree to the <a href="/terms">Terms</a>.</p>`
            : ""
        }
        <button class="btn block" style="margin-top:18px">${signup ? "Create account" : "Log in"}</button>
      </form>
      ${
        signup
          ? `<script>
              (function () {
                var f = document.currentScript.previousElementSibling;
                function check() {
                  f.password_confirm.setCustomValidity(
                    f.password_confirm.value && f.password_confirm.value !== f.password.value ? "Passwords don't match." : "");
                }
                f.password.addEventListener("input", check);
                f.password_confirm.addEventListener("input", check);
              })();
            </script>
            <p class="meta">Already have an account? <a href="/login">Log in</a></p>`
          : `<p class="meta">New here? <a href="/signup">Start a free trial</a></p>`
      }
    </div>
    `
  );
}

function opportunityList(matches) {
  return matches
    .map(
      (m) => `
      <div class="opp">
        <a class="title" href="${escapeHtml(m.ui_link)}" target="_blank" rel="noopener">${escapeHtml(m.title)}</a>
        <div class="meta">${escapeHtml(m.agency || "Agency not listed")}</div>
        <div class="meta">
          ${escapeHtml(m.notice_type || "")} · Due ${escapeHtml(formatDeadline(m.response_deadline))}
          ${m.state ? ` · ${escapeHtml(m.city ? `${m.city}, ${m.state}` : m.state)}` : ""}
          ${m.set_aside ? ` · ${escapeHtml(m.set_aside)}` : ""}
        </div>
        <div class="why">Match ${m.score}/100 — ${escapeHtml(m.reasons.join(" · "))}</div>
      </div>`
    )
    .join("");
}

function dashboard({ user, profile, subscription, access, matches, flash, billingReady }) {
  const hasCriteria = profile.naics_codes.length || profile.keywords.length;
  const certs = new Set(profile.certifications);

  const status = access
    ? `<div class="notice good">
         ${subscription.status === "trialing" ? "Free trial active." : "Subscription active."}
         ${profile.email_enabled ? "Your alerts go out every morning." : "Email alerts are paused (you unsubscribed). Turn them back on below."}
         <a href="/billing/portal" style="margin-left:6px">Manage billing</a>
       </div>`
    : `<div class="notice warn">
         <strong>Start your ${config.TRIAL_DAYS}-day free trial</strong> to get these by email every morning.
         ${
           billingReady
             ? `<form method="POST" action="/billing/checkout" style="margin-top:10px"><button class="btn">Start free trial</button></form>`
             : "<div class='meta'>Online checkout is being set up. Check back soon.</div>"
         }
         ${subscription.stripe_customer_id ? `<div style="margin-top:8px"><a href="/billing/portal">Manage billing</a></div>` : ""}
       </div>`;

  const visible = access ? matches : matches.slice(0, 3);
  const hidden = access ? [] : matches.slice(3, 6);

  return page(
    "Dashboard",
    `
    <h1>Hi${profile.company_name ? `, ${escapeHtml(profile.company_name)}` : ""}</h1>
    ${flash ? `<div class="notice good">${escapeHtml(flash)}</div>` : ""}
    ${status}

    <div class="card">
      <h2 style="margin-top:0">What should we look for?</h2>
      <form method="POST" action="/profile">
        <label>Company name</label>
        <input type="text" name="company_name" value="${escapeHtml(profile.company_name)}" placeholder="Acme Services LLC">

        <label>NAICS codes</label>
        <textarea name="naics_codes" placeholder="561720, 561730">${escapeHtml(profile.naics_codes.join(", "))}</textarea>
        <div class="hint">6-digit codes, separated by commas. Don't know yours? Search at census.gov/naics.</div>

        <label>Keywords</label>
        <textarea name="keywords" placeholder="janitorial, grounds maintenance, courier">${escapeHtml(profile.keywords.join(", "))}</textarea>
        <div class="hint">Words that appear in titles of work you do. Catches notices filed under other NAICS codes.</div>

        <label>States you work in</label>
        <input type="text" name="states" value="${escapeHtml(profile.states.join(", "))}" placeholder="VA, MD, DC (leave empty for nationwide)">

        <label>Certifications</label>
        <div class="checks">
          ${CERTIFICATIONS.map(
            (c) => `<label><input type="checkbox" name="certifications" value="${c.id}" ${certs.has(c.id) ? "checked" : ""}> ${escapeHtml(c.label)}</label>`
          ).join("")}
        </div>
        <div class="hint">We hide notices set aside for certifications you don't have.</div>

        <label class="checks"><span style="display:flex;gap:8px;align-items:center;font-weight:400">
          <input type="checkbox" name="email_enabled" value="1" ${profile.email_enabled ? "checked" : ""}> Email me new matches every morning
        </span></label>

        <button class="btn" style="margin-top:16px">Save</button>
      </form>
    </div>

    <div class="card">
      <h2 style="margin-top:0">Matches from the last 7 days</h2>
      ${
        !hasCriteria
          ? `<p class="meta">Add at least one NAICS code or keyword above to see matches.</p>`
          : matches.length
            ? `${opportunityList(visible)}
               ${hidden.length ? `<div class="locked">${opportunityList(hidden)}</div>
                 <p><strong>${matches.length - 3} more ${matches.length - 3 === 1 ? "match is" : "matches are"}</strong> waiting. Start your free trial to see them all.</p>` : ""}`
            : `<p class="meta">No open matches in the last 7 days yet. New notices are checked every morning.
               If this stays empty, try adding keywords or related NAICS codes.</p>`
      }
    </div>
    `,
    { user }
  );
}

function simple(title, bodyHtml, opts) {
  return page(title, `<div class="card"><h1 style="margin-top:0">${escapeHtml(title)}</h1>${bodyHtml}</div>`, opts);
}

function terms() {
  return simple(
    "Terms of Service",
    `
    <p>${escapeHtml(config.APP_NAME)} is operated by ${escapeHtml(config.COMPANY_NAME)}. By using it you agree to these terms.</p>
    <p><strong>The service.</strong> We send email alerts about federal contract opportunities published on SAM.gov that match
    the criteria you set. Opportunity data is public information from SAM.gov. We don't guarantee it is complete, accurate or
    current. Always read the official notice before deciding to bid. We are not affiliated with SAM.gov or any government agency.</p>
    <p><strong>Billing.</strong> Paid plans renew monthly until cancelled. New subscribers get a ${config.TRIAL_DAYS}-day free trial.
    Cancel any time from your dashboard (Manage billing); you keep access until the end of the paid period. Payments are processed by Stripe.</p>
    <p><strong>Your account.</strong> Keep your password private. Don't resell or redistribute the alerts.</p>
    <p><strong>Liability.</strong> The service is provided as is. To the extent allowed by law our liability is limited to the fees you paid in the last month.</p>
    ${config.SUPPORT_EMAIL ? `<p>Questions: <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a></p>` : ""}
    `
  );
}

function privacy() {
  return simple(
    "Privacy Policy",
    `
    <p>We collect your email address, a hashed password, and the alert criteria you enter (company name, NAICS codes, keywords,
    states and certifications). We use them only to run your account and send your alerts.</p>
    <p>Payments are handled by Stripe; we never see or store your card number. Emails are sent through Resend.</p>
    <p>We don't sell your information. You can unsubscribe from alerts with the link in any email, and ask us to delete your
    account${config.SUPPORT_EMAIL ? ` by writing to <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}">${escapeHtml(config.SUPPORT_EMAIL)}</a>` : ""}.</p>
    `
  );
}

module.exports = {
  page,
  simple,
  landing,
  authForm,
  dashboard,
  terms,
  privacy
};
