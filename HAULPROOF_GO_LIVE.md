# HaulProof go-live checklist (copy and paste)

This turns on payments ($99 Pro and $19 Compliance) and emails for HaulProof. It uses the **same Stripe account** as BidBrief, live mode.

**Railway project:** honest-stillness → **HaulProof** service (not Postgres).

**Already set, don't touch:** `DATABASE_URL`, `FMCSA_WEB_KEY`, `PUBLIC_URL`, `ADMIN_TOKEN`.

> **Key safety:** copy each key straight from Stripe or Resend into Railway. Never go through Notes; it once added a hidden wrong letter. Never paste a key in chat. Price IDs (`price_...`) and endings (last 4 characters) are safe to share.

---

## Part 1: Stripe products (5 min)

Stripe → make sure you're **not** in the sandbox → **Product catalog** → **+ Add product**.

| Product name (copy) | Description (copy) | Price |
|---|---|---|
| `HaulProof Pro` | `Unlimited carrier checks, sealed proof records and daily monitoring for freight brokers.` | $99.00, Recurring, Monthly |
| `HaulProof Compliance` | `DOT deadline reminders for carriers: MCS-150, UCR, IFTA, Form 2290 and your own dates.` | $19.00, Recurring, Monthly |

After saving each one, open it and copy its **price ID** (`price_...`) for Part 3.

---

## Part 2: Stripe webhook (3 min)

Stripe → **Developers** → **Webhooks** → **+ Add endpoint** (it may say "Add destination").

- **Endpoint URL (copy):**
  ```
  https://haulproof-production.up.railway.app/stripe/webhook
  ```
- **Description (copy):** `HaulProof`
- **Events to send:** select these 4:
  ```
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  ```
- Save, then tap **Reveal** under "Signing secret" and copy the `whsec_...` value for Part 3.

This is a **new, separate** webhook. Leave BidBrief's two webhooks alone (gvAA/jZR4 and oMtw/0Ehl).

---

## Part 3: Railway variables (5 min)

Railway → honest-stillness → **HaulProof** → **Variables** → **Raw Editor**.

1. Go to the **end** of the text. Don't change the lines already there.
2. Paste this block.
3. Replace each `PASTE_...` with the real value, copied straight from Stripe.
4. Tap **Update Variables**, then **Deploy**.

```
STRIPE_SECRET_KEY=PASTE_THE_SAME_rk_live_KEY_BIDBRIEF_USES
STRIPE_WEBHOOK_SECRET=PASTE_whsec_FROM_PART_2
STRIPE_PRICE_MONTHLY=PASTE_price_FOR_HAULPROOF_PRO
STRIPE_PRICE_COMPLIANCE=PASTE_price_FOR_HAULPROOF_COMPLIANCE
PRICE_LABEL=$99/month
COMPLIANCE_PRICE_LABEL=$19/month
TRIAL_DAYS=7
SUPPORT_EMAIL=Mindsetlogisticsllc@gmail.com
```

Rules:
- No spaces around `=`.
- No quotes.
- One setting per line.

---

## Part 4: Email (Resend) (5 min)

Resend → **API Keys** → **Create API key**:
- Name: `HaulProof`
- Permission: **Sending access**

Copy the key (`re_...`). Then in the same HaulProof **Raw Editor**, add:

```
RESEND_API_KEY=PASTE_re_KEY_HERE
EMAIL_FROM=HaulProof <alerts@bidbriefapp.com>
```

- `EMAIL_FROM` uses bidbriefapp.com because it's already verified in Resend.
- If Resend shows the verified domain as **alerts.bidbriefapp.com** instead, use `HaulProof <alerts@alerts.bidbriefapp.com>`.
- When HaulProof gets its own domain, verify it in Resend and change this line.

Update Variables → **Deploy**.

---

## Part 5: Check it worked (1 min)

Open **https://haulproof-production.up.railway.app/health** and check:

| Line | Should say |
|---|---|
| `"billing_configured"` | `true` |
| `"stripe_key_mode"` | `"live"` |
| `"webhook_secret_configured"` | `true` (and `webhook_secret_ends_with` = the last 4 of your new whsec) |
| `"email_configured"` | `true` |

Paste that page to Claude to double-check.

---

## Later: HaulProof's own domain

1. Buy it at IONOS, e.g. `haulproof.com`, `gethaulproof.com` or `haulproofapp.com`. Skip the add-ons.
2. In Railway → HaulProof → **Settings** → **Networking** → **+ Custom Domain**, type `www.<your-domain>` and copy the target it shows.
3. In IONOS → the domain → **DNS** → add a **CNAME**: host `www`, points to the Railway target. Don't delete the existing mail records.
4. Update `PUBLIC_URL=https://www.<your-domain>` in Railway.
5. In Stripe, edit the HaulProof webhook URL to `https://www.<your-domain>/stripe/webhook`.
6. In Resend, add and verify the new domain, then update `EMAIL_FROM`.
7. In Google Search Console, add the new domain and submit `https://www.<your-domain>/sitemap.xml`.
