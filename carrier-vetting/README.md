# Carrier Vetting (working name)

Carrier vetting for small freight brokers and dispatchers:

- **Check** a carrier by MC or USDOT number against live FMCSA data. The result is ✅ Approve, ⚠️ Review first or ❌ Do not use, with plain-English reasons. Checks cover authority, insurance on file, out-of-service orders, safety rating, BASIC alerts and fraud signals such as broker-only authority, no inspection history or zero trucks.
- **Proof record** for every check: the FMCSA data relied on, the decision, the load reference, who checked and when. It is fingerprinted with SHA-256, so any change is detectable. It can be printed or saved as PDF, and anyone can confirm it at `/verify/:id`.
- **Daily monitoring** of watched carriers. Paying customers get emailed when authority, insurance, out-of-service status, safety rating or name changes.
- **Plans:** free accounts get `FREE_LOOKUPS_PER_MONTH` checks. A subscription (Stripe) unlocks unlimited checks and monitoring.

Built from the BidAlert codebase: Node/Express, Postgres, Stripe, Resend.

## Railway variables
| Variable | Notes |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `PUBLIC_URL` | e.g. `https://xxx.up.railway.app` |
| `FMCSA_WEB_KEY` | Free. Get it from mobile.fmcsa.dot.gov/QCDevsite (sign in with Login.gov) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY` | Webhook URL: `/stripe/webhook`. Events: `checkout.session.completed` and `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` |
| `RESEND_API_KEY`, `EMAIL_FROM` | For monitoring alerts |
| `COMPANY_ADDRESS`, `SUPPORT_EMAIL` | Footer, terms and emails |
| `ADMIN_TOKEN` | `POST /admin/monitor?token=…` runs monitoring now |
| Optional | `APP_NAME`, `PRICE_LABEL`, `TRIAL_DAYS` (7), `FREE_LOOKUPS_PER_MONTH` (5), `MONITOR_HOUR_UTC` (11) |

The Stripe account is shared with InteliBid and BidAlert. This app tags its sessions and subscriptions with `metadata.app = carrier-vetting` and `metadata.cv_user_id`, and ignores every other event.

`/health` shows which settings are configured.

## Tests
`npm test` runs unit tests for FMCSA parsing, scoring, record integrity, monitoring diffs and Stripe event filtering. FMCSA field names follow the published QCMobile API elements. Confirm them against a real response once the web key is available.
