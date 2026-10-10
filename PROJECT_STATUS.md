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
   - **Sandbox (test) prices — use these in Railway now** (created 2026-10-04 6:40–6:45 PM, in this order):
     - BidAlert $29 → `price_1UMz0m89PYsnelVgDcQN4OU2` (`prod_VNkVOByMY9tS40`)
     - Professional $99 → `price_1UMz2M89PYsnelVglt0SHQuv` (`prod_VNkXZN7HSj9MUV`)
     - Business $249 → `price_1UMz3r89PYsnelVgB1mEpmrh` (`prod_VNkYGmlvHOn5wo`)
     - Enterprise $699 → `price_1UMz5b89PYsnelVgpTdVb45j` (`prod_VNkaMI0Xkm6BF6`)
   - **Live prices — use only when switching to live keys:**
     - BidAlert `price_1UMkbk89PYsnelVgFDDFVdVK`, Professional `price_1UMke289PYsnelVgOksQtrdS`, Business `price_1UMkfg89PYsnelVgTES7jc3t`, Enterprise `price_1UMki589PYsnelVgscPrFxqk`
   - 2026-10-04: a live secret key was exposed in chat and deleted/rolled. Resend + SAM keys were also exposed in chat; rotate them.
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
- Stripe: $29/month BidAlert price (sandbox `price_1UMz0m89PYsnelVgDcQN4OU2`, live `price_1UMkbk89PYsnelVgFDDFVdVK`) → `STRIPE_PRICE_ALERTS` on bidalert. Webhook: `https://bidalert-production-5a37.up.railway.app/stripe/webhook` (events: checkout.session.completed, customer.subscription.created/updated/deleted).
- Both apps download SAM.gov once a day with the same key (well within limits).

## 2026-10-05/06 sandbox launch test
- Stripe sandbox: 4 products/prices recreated (IDs above), test secret key on both apps, webhooks InteliBid (`/api/billing/webhook`, 3 events) and BidAlert (`/stripe/webhook`, 4 events), customer portal saved (cancel at period end). BidAlert `/health` all true.
- InteliBid fixes merged: #11 legacy NOT NULL columns (signup), #12 legacy jsonb/array/int columns → TEXT (profile save), #13 dashboard button overflow, #14 success page confirms Checkout Session directly so the plan turns on without waiting for the webhook.
- First test purchase (Professional) succeeded; InteliBid webhook returned 400 "Invalid Stripe signature" (wrong whsec on intelibid). Owner re-copied the secret → resent deliveries 200 OK → dashboard shows **Professional $99/month** with Manage billing. ✅ InteliBid payments work end to end in sandbox.
- InteliBid Manage billing portal works (shows Professional, card 4242, invoice Paid).
- BidAlert $29 / 7-day trial checkout works (2026-10-06). Fixes pushed to bidalert main: strip stray quotes/whitespace from env values (secret key had a leading quote, webhook secret had a space), confirm Checkout Session on return to dashboard, ignore InteliBid's events on the shared Stripe account, /health shows webhook secret last 4 + key mode. BidAlert webhook now 200 OK.
- Note: both webhooks receive every event on the account; each app ignores the other's.
- TODO before live: set public business name / statement descriptor to Mindset Logistics in **live** mode (sandbox can't); rotate Resend + SAM keys (exposed in chat); live price IDs + live keys + live webhooks.

## Business-account migration (owner set things up under personal accounts)
- **Before first real payment:** Stripe → Settings → Business details: change to Company/LLC (Mindset Logistics LLC + EIN; may need Stripe support), payout to LLC business bank account. Fixes "chisenga m" public name.
- **Later, no customer impact:** move GitHub repos to an org/business account, Railway projects to a team, Resend account email, IONOS domain contact → LLC, support email → support@mindsetlogisticsllc.net (update SUPPORT_EMAIL on both apps).
- SUPPORT_EMAIL=Mindsetlogisticsllc@gmail.com set on intelibid and bidalert (2026-10-07). InteliBid Terms/Privacy rewritten (intelibid#15); lawyer review still recommended.
- Trademark: "IntelliBid" (Conest Software, electrical estimating, since 1989) is confusingly similar to InteliBid → USPTO search + attorney before marketing; consider rename.

## ▶ RESUME HERE (saved 2026-10-07)
**Launch (InteliBid + BidAlert):** sandbox payments, webhooks and portal all tested and working. Remaining, in order:
1. ✅ (2026-10-07) Resend + SAM.gov keys rotated; old Resend key deleted. SAM key updated on intelibid, bidalert, proposal-sales-package-agent and the Hunter service. Opportunity Hunter now searches SAM.gov directly (intelibid#16) and saves results (intelibid#18 adds legacy unique indexes); confirmed working in production.
**LIVE (2026-10-10):** Stripe live mode done: account name BidBrief, statement descriptor BIDBRIEF, phone verified, payments+payouts active, products renamed BidBrief *, restricted live key (rk_live) on both apps, live webhooks imported (BidBrief whsec ends gvAA, Alerts ends oMtw), live prices on both apps, customer portal saved (cancel at period end, reasons, payment methods, invoices). intelibid#23/#24: /health billing section + strip stray spaces/quotes. 2026-10-10: first live key had a Cyrillic "х" (pasted via Notes) → every Stripe call failed on BidBrief Alerts; replaced with new key "BidBrief apps 2" pasted directly on both apps; both /health show no invalid chars (intelibid#25, bidalert main). intelibid#26 iOS Safari button/date-field fix. Delete old key "BidBrief apps" in Stripe. BidBrief app URL: https://intelibid-staging-aece.up.railway.app. NEXT: real end-to-end test ($29 Alerts trial, then cancel), Stripe website → bidbrief domain, business bank account, IRS 8822-B address change.
2. Stripe: business details → Mindset Logistics LLC + EIN, LLC bank account, public name/statement descriptor (live mode).
3. Go live: live products/prices (IDs above), live secret key, 2 live webhooks, live customer portal → Railway variables on both apps.
4. Custom domain for InteliBid (drop "staging"); trademark check on "InteliBid".
**Product value (2026-10-07):** intelibid#20 adds the **Bid Brief** on every opportunity page (verdict + reasons, real USASpending price range, requirements from the actual SAM.gov documents, what we couldn't check). Free sees verdict/checks; Professional+ sees price + requirements; Business+ sees winners/incumbents. **Renamed to BidBrief (2026-10-08):** "InteliBid" collides with IntelliBid (Conest) and BidNet calls its emails a trademarked "BidAlert". intelibid#22 renames the app to BidBrief; bidalert default APP_NAME is "BidBrief Alerts". Still to do: buy domain (bidbrief.com?), USPTO check, Railway APP_NAME/EMAIL_FROM, Stripe public name.
**Hunter search (intelibid#21):** searches a local library of every open SAM.gov notice (backfills 90 days, ~1 hour after deploy) with any word across title/agency/NAICS/PSC/place, plus live SAM.gov; blank search lists everything open; 6-digit = NAICS.
**HaulProof (2026-10-08):** live at haulproof-production.up.railway.app (Railway project honest-stillness, Postgres, DATABASE_URL, FMCSA_WEB_KEY, PUBLIC_URL set). FMCSA returns "Webkey not found" for both keys even from a browser; owner emailing fmctechsup@dot.gov. Next: Stripe + Resend.
**New project: HaulProof** (name chosen 2026-10-07; still run USPTO search + check haulproof.com). Code lives in **mindsetlogisticsllc-stack/HaulProof** (main). The `carrier-vetting/` folder here is the earlier copy. MVP built (15 tests + end-to-end test pass; see its README). To launch: (1) owner gets FMCSA QCMobile web key via Login.gov, (2) ✅ repo created, (3) new Railway project + Postgres, (4) Stripe product + webhook, (5) pick a trademark-checked name. Confirm FMCSA field names against a real response once the key works.
