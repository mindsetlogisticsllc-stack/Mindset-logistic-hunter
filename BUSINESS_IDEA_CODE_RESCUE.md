# Business idea: "Code Rescue" for absentee property owners (Dallas first)

*Research done Nov 10, 2026. Working name only; pick a final name that doesn't sound like the city.*

## The idea in one line

Every day the City of Dallas opens hundreds of code cases (high weeds, litter, junk, open structures). Many land on homes whose owners **live somewhere else** and won't see the paper notice for days or weeks. We spot those new cases first, contact the owner, **fix the problem** (mow, haul away, clean up, secure), and send photo proof the same day. They pay per job. Software finds the customers, the work earns the money, and the van does the haul-away.

## Why this is different from what exists

| What exists | What it does | What it misses |
|---|---|---|
| ViolationNet ($49/mo, 167+ cities), DOBGuard, ViolationWatch (NYC) | **Alerts only** to owners who already signed up | Nobody fixes anything; the owner still has to find a crew from far away |
| Texas Signals, Houston Foreclosure Alerts, FlaggedLeads | Sell code-violation lists **to investors who want to buy the house cheap** | Works against the owner |
| Local cleanup crews in Florida, Arizona, LA, Washington | Fix code violations for out-of-town owners | Wait for the owner to find them; no automatic detection; **nobody doing this in Dallas turned up** |

**The gap:** nobody combines *automatic detection*, *reaching the owner the same week* and *fixing it with proof* in one service, and the investor-lead sites prove the data is usable. We'd be the protective side of that data.

## Why owners will pay quickly

- **Fines:** Dallas can cite **each day** a violation continues, up to **$2,000 per citation**. Even the basic high-weeds ticket is $140 plus $36 in costs.
- **City abatement:** if the owner doesn't act, the city does the work and bills the owner with an administrative fee (reported at $166 on one 2012 bill). If unpaid, it **places a lien**. On Nov 17, 2025 the council approved a new round of these liens.
- **Follow-up cases:** after one notice in 12 months, the city can fix it, lien and cite **without another notice**.
- **Who owns these homes:** Dallas County has **~94,590 investor-owned single-family homes**, and **83% belong to small "mom-and-pop" landlords** (1–10 homes) with no property manager watching the lawn. About 10% of recent DFW buyers are out of state.
- **Volume:** Dallas logs **~200,000 code violations a year**. Weeds, litter and junk, the easiest fixes, are among the most common.

## How it works

1. **Detect (software, built by Claude):**
   - Pull new cases daily from Dallas OpenData's Code Violations data.
   - Match each address to the owner's **mailing address** in the Dallas Central Appraisal District files (free download).
   - Keep only **absentee owners** (mailing address ≠ property address).
2. **Reach the owner within 48 hours:**
   - Send a printed postcard or letter through a mail API (about $0.70–$1 each): *"A code case for high weeds was opened on 123 Elm St on Nov 3. We can fix it this week and send photo proof. Scan to book."*
   - Plain mail only (no robocalls or mass texts). Always say we're a private company, not the city.
3. **Book and pay online:** a QR code goes to a page showing their case. They pick a fix and pay through Stripe (already set up).
4. **Fix it:** do it yourself (haul-away with the van) or send a local mowing crew paid per job. Take before-and-after photos.
5. **Proof:** email the owner timestamped photos to forward to the city inspector. HaulProof's sealed-record feature already does this.
6. **Keep them:** offer **"Code Guard"**, watching all their properties monthly with priority fixes and seasonal mowing.

## Pricing (starting point; check local rates first)

| Service | Price | Notes |
|---|---|---|
| High weeds / mowing (typical lot) | $95–$175 | Crew cost ~$40–$70 |
| Litter / junk haul-away | $150–$450 | Dallas junk removal runs $79–$155 small, $275–$475 larger; dump fees extra |
| Rush (within 24h) | +$50 | |
| "Code Guard" monitoring | $19 per property/month, or $49 for up to 5 | Matches what ViolationNet charges for alerts alone; ours includes fixes |

## Test before spending real money

| Step | Cost | What we learn |
|---|---|---|
| Send 200 postcards to absentee owners with brand-new weeds/litter cases | ~$170–$200 | The response rate |
| If 2–5% book (an **assumption** to test) | 4–10 jobs × ~$180 | ~$720–$1,800 revenue from a ~$200 test |

If fewer than 1% respond after 400 postcards, change the message or the offer before scaling.

## Startup costs

- **General liability insurance:** roughly $40–$80/month. Needed before working on other people's property.
- **Mail:** ~$200 to test.
- **Software:** $0 (Claude builds it on the existing Railway, Stripe and Resend setup).
- **Tools:** mower or trimmer optional at first; subcontract mowing. The van covers haul-away.

## Rules to stay safe and legal

- Never look or sound like the city. No "Code Compliance" in the name, no city seals, and always print **"Private company. Not affiliated with the City of Dallas."**
- Mail is fine. **No robocalls, no mass texts, no auto-dialed calls** (federal TCPA rules).
- Only offer work that needs **no license**: mowing, cleanup, haul-away, boarding up. **No plumbing, electrical or structural repairs** (those need licensed trades); refer those out.
- Never promise the case will close. The city inspector decides. We provide the work and the proof.
- Get the owner's written OK, through the booking page, before anyone steps on the property.

## Things to verify first (Claude can do 1 and 2 from the server)

1. That Dallas OpenData's current Code Violations data (`yvha-at84`) updates daily and includes the address, case type and date opened. The sandbox can't reach it; check from Railway like the FMCSA files.
2. That the DCAD download includes the owner mailing address. Third-party tools say it does.
3. Current Dallas abatement fees: call Special Collections at (214) 670-3438.

## Why it fits you

- **Software you already own** (alerts, public data, Stripe, sealed photo records) does the hard part: finding customers before anyone else.
- **Local and physical,** so big online companies can't easily copy it.
- **Paid per job from day one,** with a monthly subscription on top.
- **It helps people:** owners avoid fines and liens, and neighborhoods get cleaned up.
- **It grows city by city:** Fort Worth, Houston and San Antonio publish similar data.

## Sources

- Dallas code data: [Code Violations dataset](https://www.dallasopendata.com/Services/Code-Violations/yvha-at84), [Code Violation Activities](https://www.dallasopendata.com/Services/Code-Violation-Activities/hqes-3ct4)
- Fines and abatement: [Dallas court fines list (PDF)](https://dallascityhall.com/departments/courtdetentionservices/PublishingImages/Pages/how-much-is-my-fine/Court%20Fines%20List.pdf), [Dallas notice wording ($2,000 per citation)](https://dallascityhall.com/government/Boards-and-Commissions/Board-of-Adjustment/DCH%20Documents/BOA-25-000021_Application%20Materials.pdf), [Nuisance Abatement Division](https://dallascityhall.com/departments/codecompliance/Pages/nuisance-abatement-division.aspx), [Dallas code Sec. 18-18 (charges and lien)](https://codelibrary.amlegal.com/codes/dallas/latest/dallas_tx/0-0-0-108694), [Dallas News: $166 admin fee story](https://www.dallasnews.com/news/investigations/2012/07/21/family-asks-why-dallas-code-enforcement-attached-lien-to-rental-property), [Top 10 code violations](https://dallascityhall.com/departments/codecompliance/Pages/code_violations_new.aspx)
- Owners: [BatchData Dallas County investor report 2026-Q1](https://reports.batchdata.io/investorpulse-reports/2026-q1-county-tx-dallas/), [iBuyer Dallas investor report 2026](https://ibuyer.com/blog/dallas-housing-market-report/), [DCAD data products](https://dallascad.org/DataProducts.aspx)
- Competitors: [ViolationNet pricing](https://violationnet.com/pricing), [DOBGuard](https://dobguard.com/), [Texas Signals](https://texassignals.com/buy-house-with-code-violations-texas), [Houston Foreclosure Alerts](https://www.houstonforeclosurealerts.com/houston-code-violations/), [H&M Prestige (FL)](https://prestigelawnswfl.com/services/code-compliance), [Breasy (AZ)](https://joinbreasy.com/locations/az/phoenix/apache-junction/hoa-violation-cleanup/), [The Code Clinic (FL)](https://thecodeclinicpa.com/blog/out-of-state-owner-code-violation-florida.html)
- Junk removal prices: [Dropcurb Dallas](https://dropcurb.com/cost/bulk-junk-removal/dallas-tx)
