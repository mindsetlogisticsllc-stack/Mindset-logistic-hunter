# Freight fraud / carrier vetting: research (2026-10-07)

## Why now
- **Montgomery v. Caribe Transport (U.S. Supreme Court, May 14, 2026, unanimous):** brokers can be sued under state law for negligently selecting a carrier. Affects ~28,000 brokers moving ~1/3 of US freight. Brokers that "act reasonably" can defend, so documented vetting matters. [JD Supra](https://www.jdsupra.com/legalnews/supreme-court-clears-path-for-negligent-8015412/)
- Cargo theft/fraud losses ~$725M in 2025 (+60%), avg $273,990 per incident. [PCS](https://pcssoft.com/blog/how-to-approach-carrier-vetting-in-2026/)
- Double brokering +400% since 2020. [LoadConnect](https://loadconnect.io/blog/broker-fraud-trucking-how-to-protect-yourself-2026)
- Broker financial responsibility rule ($75k BMC-84/85) fully effective Jan 16, 2026. FMCSA Motus registration launched May 2026; MC numbers still active, phase-out under consideration. [DISA](https://disa.com/news/fmcsa-motus-registration-system-2026/)
- Carrier side: half of surveyed owner-operators were stiffed for a full load by a broker; 19,000 fake loads posted under TQL's name in March 2025. [Overdrive](https://www.overdriveonline.com/business/article/15829986/how-ownerops-dodge-shady-brokers-ensuring-payment-when-due)

## Free data
FMCSA QCMobile API (free web key via Login.gov): carrier by DOT/MC/name, authority, insurance on file vs required, 5 of 7 BASIC percentiles, out-of-service status, cargo, operation class. [FMCSA dev site](https://mobile.fmcsa.dot.gov/QCDevsite/home), [endpoint summary](https://apify.com/mooseandraven/fmcsa-carrier-safety-suite)

## Competitors / prices
| Product | Price | Notes |
|---|---|---|
| Highway | ~$1,500–2,500/mo (unpublished) | Enterprise; too expensive for small brokers |
| Descartes MyCarrierPortal | from $515/mo | Onboarding |
| RMIS | $200–350/mo | Larger brokerages |
| Carrier Assure | $175–300/mo | Performance signals |
| Carrier411 | $99–249/mo | Monitoring |
| VettedHaul | $99 / $249 | Small brokers |
| Cipher & Row | $99 dispatchers / $299 brokers | Audit trail focus |
Sources: [VettedHaul](https://vettedhaul.com/blog/highway-alternative), [Cipher & Row](https://www.cipherandrow.com/blog/carrier-vetting-audit-trails-2026-tms-highway-descartes-cipher-row), [CarrierOwl](https://carrierowl.com/blog/carrier411-alternatives)

**Takeaway:** low end ($99–300) is already crowded. Winning needs a sharp angle + distribution, not just FMCSA lookups.

## Recommended angle
"Proof you vetted the carrier": every load gets a timestamped, tamper-evident vetting record (PDF) a broker can hand to their insurer or lawyer post-Montgomery, plus identity/fraud red flags and daily change monitoring. Target: small brokers (1–20 people) and dispatchers. Later: a cheap carrier-side "vet this broker" tool.

## MVP (2–3 weeks, reuses BidAlert/InteliBid code)
1. FMCSA lookup by MC/DOT → authority age, insurance, BASICs, OOS
2. Red-flag score (new/transferred authority, insurance gap, OOS, conditional rating, contact mismatch)
3. Load vetting record → PDF with timestamp + data snapshot hash
4. Saved carriers → daily alerts on authority/insurance/safety changes
5. Stripe plans; free single lookup as lead magnet
Needs from owner: FMCSA web key (Login.gov), name (trademark-search first), domain.
