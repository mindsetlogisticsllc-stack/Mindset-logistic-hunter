"use strict";

/*
  Every setting comes from Railway environment variables so the same code
  runs locally and in production. Only DATABASE_URL is required to boot;
  the rest switch features on as they are configured.
*/

function list(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  APP_NAME: process.env.APP_NAME || "BidAlert",
  PORT: Number(process.env.PORT || 8080),
  DATABASE_URL: process.env.DATABASE_URL || "",
  PUBLIC_URL: (process.env.PUBLIC_URL || "").replace(/\/+$/, ""),

  // SAM.gov public API key (sam.gov → Account Details → Public API Key).
  SAM_API_KEY: process.env.SAM_API_KEY || "",

  // Resend (resend.com) for email. FROM must be on a verified domain.
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  EMAIL_FROM: process.env.EMAIL_FROM || "",

  // Required in every marketing email by CAN-SPAM.
  COMPANY_NAME: process.env.COMPANY_NAME || "Mindset Logistics LLC",
  COMPANY_ADDRESS: process.env.COMPANY_ADDRESS || "",
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL || "",

  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || "",
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || "",
  STRIPE_PRICE_ALERTS: process.env.STRIPE_PRICE_ALERTS || "",
  PRICE_LABEL: process.env.PRICE_LABEL || "$29/month",
  TRIAL_DAYS: Number(process.env.TRIAL_DAYS || 7),

  // Hour (UTC) the daily digest goes out. 12 UTC = 8am Eastern (EDT).
  DIGEST_HOUR_UTC: Number(process.env.DIGEST_HOUR_UTC || 12),
  MAX_ALERTS_PER_EMAIL: Number(process.env.MAX_ALERTS_PER_EMAIL || 25),

  // Lets the owner trigger a run by hand: POST /admin/run?token=...
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || "",
  ADMIN_EMAILS: list(process.env.ADMIN_EMAILS).map((e) => e.toLowerCase())
};
