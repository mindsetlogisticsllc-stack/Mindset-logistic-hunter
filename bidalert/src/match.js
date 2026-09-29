"use strict";

/*
  Decides whether an opportunity is worth emailing to a customer and how
  high to rank it. Kept free of database/network code so it is easy to
  test and tune.
*/

// SAM.gov set-aside codes → certification the bidder must hold.
// Small-business set-asides (SBA, SBP) are open to any small business.
const SET_ASIDE_REQUIREMENTS = {
  "8A": ["8a"],
  "8AN": ["8a"],
  HZC: ["hubzone"],
  HZS: ["hubzone"],
  SDVOSBC: ["sdvosb"],
  SDVOSBS: ["sdvosb"],
  WOSB: ["wosb", "edwosb"],
  WOSBSS: ["wosb", "edwosb"],
  EDWOSB: ["edwosb"],
  EDWOSBSS: ["edwosb"],
  VSA: ["vosb", "sdvosb"],
  VSS: ["vosb", "sdvosb"],
  IEE: ["isbee"],
  ISBEE: ["isbee"]
};

const CERTIFICATIONS = [
  { id: "8a", label: "8(a)" },
  { id: "hubzone", label: "HUBZone" },
  { id: "sdvosb", label: "Service-Disabled Veteran-Owned (SDVOSB)" },
  { id: "vosb", label: "Veteran-Owned (VOSB)" },
  { id: "wosb", label: "Women-Owned (WOSB)" },
  { id: "edwosb", label: "Economically Disadvantaged Women-Owned (EDWOSB)" },
  { id: "isbee", label: "Indian Small Business Economic Enterprise (ISBEE)" }
];

function eligibleForSetAside(opportunity, certifications) {
  const code = String(opportunity.set_aside_code || "").toUpperCase();
  const required = SET_ASIDE_REQUIREMENTS[code];

  if (!required) {
    return true;
  }

  return required.some((cert) => certifications.includes(cert));
}

function scoreOpportunity(opportunity, profile, now = new Date()) {
  const naicsCodes = profile.naics_codes || [];
  const keywords = (profile.keywords || []).map((k) => k.toLowerCase()).filter(Boolean);
  const states = (profile.states || []).map((s) => s.toUpperCase());
  const certifications = profile.certifications || [];

  if (opportunity.response_deadline && new Date(opportunity.response_deadline) < now) {
    return null;
  }

  if (states.length && opportunity.state && !states.includes(opportunity.state.toUpperCase())) {
    return null;
  }

  if (!eligibleForSetAside(opportunity, certifications)) {
    return null;
  }

  const reasons = [];
  let score = 0;

  const naics = String(opportunity.naics_code || "");

  if (naics && naicsCodes.includes(naics)) {
    score += 50;
    reasons.push(`NAICS ${naics}`);
  } else if (naics && naicsCodes.some((code) => code.slice(0, 4) === naics.slice(0, 4))) {
    score += 25;
    reasons.push(`related NAICS ${naics}`);
  }

  const title = String(opportunity.title || "").toLowerCase();
  const matchedKeywords = keywords.filter((keyword) => title.includes(keyword));

  if (matchedKeywords.length) {
    score += Math.min(40, matchedKeywords.length * 20);
    reasons.push(`keyword: ${matchedKeywords.join(", ")}`);
  }

  // Location and set-aside only rank a match; they never create one.
  if (score === 0) {
    return null;
  }

  if (states.length && opportunity.state) {
    score += 10;
    reasons.push(`in ${opportunity.state}`);
  }

  if (SET_ASIDE_REQUIREMENTS[String(opportunity.set_aside_code || "").toUpperCase()]) {
    score += 15;
    reasons.push(`set aside for you (${opportunity.set_aside})`);
  } else if (["SBA", "SBP"].includes(String(opportunity.set_aside_code || "").toUpperCase())) {
    score += 5;
    reasons.push("small business set-aside");
  }

  return { score: Math.min(100, score), reasons };
}

function rankMatches(opportunities, profile, limit, now = new Date()) {
  return opportunities
    .map((opportunity) => ({ opportunity, result: scoreOpportunity(opportunity, profile, now) }))
    .filter((item) => item.result)
    .sort((a, b) => b.result.score - a.result.score)
    .slice(0, limit)
    .map(({ opportunity, result }) => ({ ...opportunity, score: result.score, reasons: result.reasons }));
}

// Form input helpers: accept commas, spaces or new lines.
function parseNaics(value) {
  return [...new Set(String(value || "").match(/\b\d{6}\b/g) || [])].slice(0, 25);
}

function parseKeywords(value) {
  return [
    ...new Set(
      String(value || "")
        .split(/[\n,;]+/)
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length >= 3)
    )
  ].slice(0, 25);
}

function parseStates(value) {
  return [
    ...new Set(
      String(value || "")
        .toUpperCase()
        .match(/\b[A-Z]{2}\b/g) || []
    )
  ].slice(0, 60);
}

function parseCertifications(values) {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const valid = CERTIFICATIONS.map((c) => c.id);
  return list.filter((value) => valid.includes(value));
}

module.exports = {
  CERTIFICATIONS,
  scoreOpportunity,
  rankMatches,
  eligibleForSetAside,
  parseNaics,
  parseKeywords,
  parseStates,
  parseCertifications
};
