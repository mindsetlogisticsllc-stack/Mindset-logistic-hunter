"use strict";

const config = require("./config");
const { escapeHtml } = require("./html");

function emailConfigured() {
  return Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
}

async function sendEmail({ to, subject, html, text, unsubscribeUrl }, fetchImpl = fetch) {
  if (!emailConfigured()) {
    throw new Error("Email is not configured (RESEND_API_KEY and EMAIL_FROM)");
  }

  const headers = {};

  if (unsubscribeUrl) {
    // Lets Gmail/Outlook show their own "Unsubscribe" button.
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }

  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: config.EMAIL_FROM, to: [to], subject, html, text, headers })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Resend HTTP ${response.status}: ${body.slice(0, 300)}`);
  }

  return response.json().catch(() => ({}));
}

function formatDeadline(value) {
  if (!value) {
    return "No deadline listed";
  }

  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "America/New_York"
  });
}

function footerHtml(unsubscribeUrl) {
  return `
    <p style="color:#6b7280;font-size:12px;line-height:1.5;margin-top:28px">
      You're receiving this because you signed up for ${escapeHtml(config.APP_NAME)} alerts.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a>
      · <a href="${escapeHtml(config.PUBLIC_URL)}/dashboard" style="color:#6b7280">Change what you get</a><br>
      ${escapeHtml(config.COMPANY_NAME)}${config.COMPANY_ADDRESS ? ` · ${escapeHtml(config.COMPANY_ADDRESS)}` : ""}<br>
      Opportunity data comes from SAM.gov. Always confirm details in the official notice before bidding.
    </p>`;
}

function renderDigest({ profile, matches, date, unsubscribeUrl }) {
  const name = profile.company_name || "your company";
  const subject = `${matches.length} new contract ${matches.length === 1 ? "match" : "matches"} for ${name}`;

  const rows = matches
    .map(
      (m) => `
      <tr>
        <td style="padding:14px 0;border-bottom:1px solid #e5e7eb">
          <a href="${escapeHtml(m.ui_link)}" style="font-size:16px;font-weight:600;color:#111827;text-decoration:none">${escapeHtml(m.title)}</a>
          <div style="font-size:13px;color:#4b5563;margin-top:4px">
            ${escapeHtml(m.agency || "Agency not listed")}
          </div>
          <div style="font-size:13px;color:#4b5563;margin-top:4px">
            ${escapeHtml(m.notice_type || "")} · Due ${escapeHtml(formatDeadline(m.response_deadline))}
            ${m.state ? ` · ${escapeHtml(m.city ? `${m.city}, ${m.state}` : m.state)}` : ""}
            ${m.set_aside ? ` · ${escapeHtml(m.set_aside)}` : ""}
          </div>
          <div style="font-size:12px;color:#047857;margin-top:6px">
            Match ${m.score}/100 — ${escapeHtml(m.reasons.join(" · "))}
          </div>
        </td>
      </tr>`
    )
    .join("");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <h1 style="font-size:20px;margin:0 0 4px">${escapeHtml(subject)}</h1>
      <p style="color:#4b5563;margin:0 0 12px">New on SAM.gov ${escapeHtml(date)}, best matches first.</p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <p style="margin-top:20px">
        <a href="${escapeHtml(config.PUBLIC_URL)}/dashboard" style="background:#111827;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-size:14px">See all matches</a>
      </p>
      ${footerHtml(unsubscribeUrl)}
    </div>`;

  const text = [
    subject,
    `New on SAM.gov ${date}.`,
    "",
    ...matches.map(
      (m) =>
        `- ${m.title}\n  ${m.agency || ""}\n  Due ${formatDeadline(m.response_deadline)} · Match ${m.score}/100\n  ${m.ui_link}`
    ),
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
    `${config.COMPANY_NAME}${config.COMPANY_ADDRESS ? `, ${config.COMPANY_ADDRESS}` : ""}`
  ].join("\n");

  return { subject, html, text };
}

module.exports = {
  emailConfigured,
  sendEmail,
  renderDigest,
  formatDeadline
};
