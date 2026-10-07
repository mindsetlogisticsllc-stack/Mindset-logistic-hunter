"use strict";

const config = require("./config");
const { escapeHtml } = require("./html");

// PUBLIC_URL is required too: alert links and unsubscribe links are built
// from it, and an email with broken unsubscribe links must never go out.
function emailConfigured() {
  return Boolean(config.RESEND_API_KEY && config.EMAIL_FROM && config.PUBLIC_URL);
}

async function sendEmail({ to, subject, html, text, unsubscribeUrl }, fetchImpl = fetch) {
  if (!emailConfigured()) {
    throw new Error("Email is not configured (RESEND_API_KEY, EMAIL_FROM and PUBLIC_URL)");
  }

  const headers = {};

  if (unsubscribeUrl) {
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

// One email listing every change found on the customer's watched carriers.
function renderChangeAlert({ changes, unsubscribeUrl }) {
  const serious = changes.some((c) => c.items.some((i) => i.serious));
  const subject = `${serious ? "⚠️ " : ""}${changes.length} watched carrier${changes.length === 1 ? "" : "s"} changed at FMCSA`;

  const blocks = changes
    .map(
      (c) => `
      <div style="padding:14px 0;border-bottom:1px solid #e5e7eb">
        <div style="font-weight:600;font-size:15px">${escapeHtml(c.legal_name || "Carrier")} · USDOT ${escapeHtml(c.dot_number)}</div>
        <ul style="margin:6px 0 0;padding-left:18px;font-size:14px;color:#374151">
          ${c.items
            .map(
              (i) =>
                `<li style="${i.serious ? "color:#b91c1c;font-weight:600" : ""}">${escapeHtml(i.label)}: ${escapeHtml(i.before)} → ${escapeHtml(i.after)}</li>`
            )
            .join("")}
        </ul>
        <a href="${escapeHtml(config.PUBLIC_URL)}/check?q=${encodeURIComponent(c.dot_number)}" style="font-size:13px;color:#1d4ed8">Re-check this carrier →</a>
      </div>`
    )
    .join("");

  const footer = `
    <p style="color:#6b7280;font-size:12px;line-height:1.5;margin-top:24px">
      You get this because you watch these carriers in ${escapeHtml(config.APP_NAME)}.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#6b7280">Unsubscribe</a><br>
      ${escapeHtml(config.COMPANY_NAME)}${config.COMPANY_ADDRESS ? ` · ${escapeHtml(config.COMPANY_ADDRESS)}` : ""}<br>
      Data from FMCSA. Always confirm before tendering a load.
    </p>`;

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#111827">
      <h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(subject)}</h1>
      ${blocks}
      ${footer}
    </div>`;

  const text = [
    subject,
    "",
    ...changes.flatMap((c) => [
      `${c.legal_name} (USDOT ${c.dot_number})`,
      ...c.items.map((i) => `  - ${i.label}: ${i.before} -> ${i.after}`),
      ""
    ]),
    `Unsubscribe: ${unsubscribeUrl}`
  ].join("\n");

  return { subject, html, text };
}

module.exports = { emailConfigured, sendEmail, renderChangeAlert };
