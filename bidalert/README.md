# BidAlert

Daily email alerts of new SAM.gov federal contract opportunities, matched to each customer's NAICS codes, keywords, states and certifications. $29/month with a 7-day free trial, billed through Stripe.

## How it works
1. A customer signs up and sets NAICS codes, keywords, states and certifications (8(a), HUBZone, SDVOSB, VOSB, WOSB, EDWOSB, ISBEE).
2. Every morning (`DIGEST_HOUR_UTC`, default 12 UTC = 8am Eastern) the app downloads **all** of yesterday's SAM.gov notices once. That's 1–3 API calls, so it stays far under SAM.gov's daily limit however many customers there are.
3. It drops award notices, special notices and anything set aside for a certification the customer doesn't hold, then ranks the rest per customer and emails only new matches. `sent_alerts` prevents repeats.
4. Non-subscribers see their top 3 matches on the dashboard as a teaser. Subscribers get everything plus the email.

## Deploy on Railway
1. New project → **Deploy from GitHub repo** → this repo.
2. **+ New → Database → PostgreSQL**, then on the BidAlert service add the variable `DATABASE_URL` as a reference to the Postgres `DATABASE_URL`.
3. Add the variables below and deploy. Open `/health` to see what is configured.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Reference to Railway Postgres |
| `PUBLIC_URL` | Your site address, e.g. `https://bidalert.up.railway.app` (used in email links) |
| `SAM_API_KEY` | sam.gov → Account Details → Public API Key |
| `RESEND_API_KEY` | resend.com → API Keys |
| `EMAIL_FROM` | e.g. `BidAlert <alerts@yourdomain.com>`; the domain must be verified in Resend |
| `COMPANY_ADDRESS` | Your business mailing address (required by law in marketing email) |
| `SUPPORT_EMAIL` | Shown in the footer, terms and privacy pages |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys |
| `STRIPE_PRICE_ALERTS` | Price ID of a $29/month recurring price |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook to `https://<site>/stripe/webhook` with events `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` |
| `ADMIN_TOKEN` | Any long random string; lets you trigger a run by hand |
| Optional | `APP_NAME`, `COMPANY_NAME`, `PRICE_LABEL`, `TRIAL_DAYS` (7), `DIGEST_HOUR_UTC` (12), `MAX_ALERTS_PER_EMAIL` (25) |

In Stripe, also turn on **Settings → Billing → Customer portal** so customers can cancel and update their card.

## Run a digest now
```
curl -X POST "https://<site>/admin/run?token=<ADMIN_TOKEN>"
```
This returns something like `{"ingested":812,"sent":3,"failed":0}`.

## Develop
```
npm install
npm test
DATABASE_URL=postgres://... node server.js
```
