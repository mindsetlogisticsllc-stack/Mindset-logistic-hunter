# InteliBid launch status

Last updated: 2026-09-29. All code changes below are merged into `main` of each repo.

## Repos
| Service | Repo | Pipeline step |
|---|---|---|
| InteliBid (web app, billing, pipeline) | `mindsetlogisticsllc-stack/intelibid` | 1–2, orchestrates 3–8 |
| Eligibility agent | `mindsetlogisticsllc-stack/Eligibility-Agent.` | 3 → `POST /check` |
| Contract analyzer | `mindsetlogisticsllc-stack/mindset-contract-analyzer` | 4 → `POST /analyze` |
| Performer / subcontractor | `mindsetlogisticsllc-stack/mindset-opportunity-Ai` | 5 → `POST /performer-api` |
| Pricing & proposal | `mindsetlogisticsllc-stack/mindset-pricing-proposal-agent` | 6 → `POST /research-api` |
| Partner finder & bid | `mindsetlogisticsllc-stack/proposal-sales-package-agent` | 7 → `POST /find-partners`, 8 → `POST /prepare-bid` |

## Done (merged)
- intelibid#1: rebuild legacy `sessions` table; paid features require an active Stripe subscription (signup/cancel paywall bypass); login rate limit; Secure cookie.
- intelibid#2, #3: pipeline calls each agent's real API route with the opportunity + company profile; findings shown on the pipeline page.
- Eligibility-Agent.#1, mindset-contract-analyzer#1: score against the customer's own NAICS/services (falls back to Mindset's).
- intelibid#4: existing users can upgrade; Stripe customer portal (manage/cancel/switch); no double subscriptions; plan sync from Stripe.
- intelibid#5: DB startup recovers from SSL mismatch and old tables missing columns; `/health` shows `database_error`.
- intelibid#6: password confirmation on signup.
- intelibid#7: BidAlert daily email alerts built into InteliBid paid plans (one package: pipeline + alerts). Needs on intelibid: `SAM_API_KEY`, `PUBLIC_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, `COMPANY_ADDRESS`, `ADMIN_TOKEN`.
- intelibid#8: BidAlert listed on all paid plan cards.
- intelibid#9: Proposal Builder (Enterprise): compliance checklist, key rules, outline in evaluation order, price-to-win from USASpending. Phase 2 (AI first drafts) needs an Anthropic API key.

All 8 steps tested end to end locally with all agents (SAM.gov stubbed; sandbox can't reach it).

## Confirmed live (2026-09-29)
- InteliBid URL: https://intelibid-staging-aece.up.railway.app (has "staging" in it; give it app.mindsetlogisticsllc.net before announcing).
- BidAlert URL: https://bidalert-production-5a37.up.railway.app
- Resend: alerts.mindsetlogisticsllc.net verified (2026-10-03, DNS at IONOS).
- InteliBid /health (2026-10-04): database, bidalert.sam_configured and bidalert.email_configured all true. Variables on intelibid: DATABASE_URL, EMAIL_FROM, PUBLIC_URL, RESEND_API_KEY, SAM_API_KEY, COMPANY_ADDRESS, ADMIN_TOKEN.
- `/health` → `"database": true` (limited mode fixed).
- `SAM_API_KEY` is set on proposal-sales-package-agent (steps 7–8). Check `/health` there shows `"samApiConfigured": true`.

## Waiting on the owner
1. Test all 8 steps on your own account (see "Testing before Stripe" below).
2. Railway: intelibid **Settings → Source** must deploy `main` (not the old `intelibid-5.4-launch` branch).
3. Stripe account (dashboard.stripe.com):
   - Activate account; add business bank account (Settings → Business → Bank accounts) — payouts land here.
   - Products/prices created in test mode (2026-10-04):
     - Professional $99 → `price_1UMke289PYsnelVgOksQtrdS` (`prod_VNVfc9Kxe2B7cd`)
     - Business $249 → `price_1UMkfg89PYsnelVgTES7jc3t` (`prod_VNVhkQEJSNYu6w`)
     - Enterprise $699 → `price_1UMki589PYsnelVgscPrFxqk` (`prod_VNVjn2o69Cq4oN`)
     - BidAlert $29 → `price_1UMkbk89PYsnelVgFDDFVdVK` (`prod_VNVc7JgqMeQkj6`)
     - Mapping inferred from creation time (3:19 / 3:21 / 3:23 AM); confirm by product name.
   - Enable Customer portal (Settings → Billing → Customer portal), allow cancel + plan switching.
   - Webhook → `https://<intelibid-url>/api/billing/webhook`, events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
4. Railway variables on intelibid: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PROFESSIONAL`, `STRIPE_PRICE_BUSINESS`, `STRIPE_PRICE_ENTERPRISE`.
5. Optional: also add `SAM_API_KEY` to intelibid so "Find Teaming Partners" includes SAM.gov (otherwise USASpending only).
6. Test in Stripe test mode (card 4242 4242 4242 4242): buy → paid steps unlock → cancel via Manage billing → they lock. Then switch to live keys and announce.

## Testing before Stripe
Run in Railway → PostgreSQL → Data → Query (replace the email):
```sql
UPDATE subscriptions SET plan_id='enterprise', status='active', updated_at=NOW()
WHERE company_id IN (SELECT cm.company_id FROM company_memberships cm
  JOIN users u ON u.id=cm.user_id WHERE u.email='you@yourcompany.com');
```
Expect `UPDATE 1`. Then: fill company profile → Hunter search → start pipeline → Run steps 3–8; each step's findings appear under "What happened so far".
Undo afterwards: same query with `plan_id='free'`.

---

# BidAlert (standalone) status
Kept as its own $29/month entry product (owner's decision, 2026-10-03) alongside the alerts built into InteliBid paid plans. BidAlert = leads only; InteliBid = full package (upgrade path).
- Repo `mindsetlogisticsllc-stack/bidalert`, Railway project `vivacious-victory` (bidalert + Postgres). Do not delete.
- Domain: mindsetlogisticsllc.net. Resend domain `alerts.mindsetlogisticsllc.net` shared by both apps:
  - BidAlert `EMAIL_FROM="BidAlert <alerts@alerts.mindsetlogisticsllc.net>"`
  - InteliBid `EMAIL_FROM="InteliBid <alerts@alerts.mindsetlogisticsllc.net>"`
- Stripe: $29/month BidAlert price `price_1UMkbk89PYsnelVgFDDFVdVK` → `STRIPE_PRICE_ALERTS` on bidalert. Webhook: `https://bidalert-production-5a37.up.railway.app/stripe/webhook` (events: checkout.session.completed, customer.subscription.created/updated/deleted).
- Both apps download SAM.gov once a day with the same key (well within limits).
