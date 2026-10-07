"use strict";

/*
  Every setting comes from Railway environment variables so the same code
  runs locally and in production. Only DATABASE_URL is required to boot;
  the rest switch features on as they are configured.
*/

// Railway's raw editor makes it easy to save a value with stray quotes or
// spaces around it (e.g. "\"sk_test_...\""), which Stripe and Resend then
// reject. Strip them so a pasted key just works.
function env(name, fallback = "") {
  const value = String(process.env[name] ?? "")
    .trim()
    .replace(/^["'\u201c\u201d]+|["'\u201c\u201d]+$/g, "")
    .trim();

  return value || fallback;
}

// API keys, secrets and price IDs never contain whitespace, but copying a
// long value on a phone can insert a space or line break where it wrapped.
function secret(name) {
  return env(name).replace(/\s+/g, "");
}

// Accept "example.up.railway.app" as well as "https://example.up.railway.app/"
// so a pasted domain still produces working email links.
function siteUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");

  if (!trimmed) {
    return "";
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function list(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = {
  // Working name until a trademark-checked brand is chosen.
  APP_NAME: env("APP_NAME", "Carrier Vetting"),
  PORT: Number(env("PORT", "8080")),
  DATABASE_URL: env("DATABASE_URL"),
  PUBLIC_URL: siteUrl(env("PUBLIC_URL")),

  // FMCSA QCMobile web key (mobile.fmcsa.dot.gov/QCDevsite, sign in with Login.gov).
  FMCSA_WEB_KEY: secret("FMCSA_WEB_KEY"),

  // Resend (resend.com) for monitoring alerts. FROM must be on a verified domain.
  RESEND_API_KEY: secret("RESEND_API_KEY"),
  EMAIL_FROM: env("EMAIL_FROM"),

  COMPANY_NAME: env("COMPANY_NAME", "Mindset Logistics LLC"),
  COMPANY_ADDRESS: env("COMPANY_ADDRESS"),
  SUPPORT_EMAIL: env("SUPPORT_EMAIL"),

  STRIPE_SECRET_KEY: secret("STRIPE_SECRET_KEY"),
  STRIPE_WEBHOOK_SECRET: secret("STRIPE_WEBHOOK_SECRET"),
  STRIPE_PRICE_MONTHLY: secret("STRIPE_PRICE_MONTHLY"),
  PRICE_LABEL: env("PRICE_LABEL", "$99/month"),
  TRIAL_DAYS: Number(env("TRIAL_DAYS", "7")),

  // Free accounts get this many lookups per calendar month.
  FREE_LOOKUPS_PER_MONTH: Number(env("FREE_LOOKUPS_PER_MONTH", "5")),

  // Hour (UTC) the daily monitoring run starts. 11 UTC = 6am Central (CDT).
  MONITOR_HOUR_UTC: Number(env("MONITOR_HOUR_UTC", "11")),

  ADMIN_TOKEN: secret("ADMIN_TOKEN"),

  siteUrl,
  env,
  secret
};
