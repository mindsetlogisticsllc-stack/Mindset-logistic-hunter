"use strict";

const test = require("node:test");
const assert = require("node:assert");
const {
  scoreOpportunity,
  rankMatches,
  parseNaics,
  parseKeywords,
  parseStates,
  parseCertifications
} = require("../src/match");

const now = new Date("2026-09-30T12:00:00Z");

const profile = {
  naics_codes: ["561720"],
  keywords: ["janitorial", "custodial"],
  states: ["VA", "MD"],
  certifications: ["sdvosb"]
};

function opp(overrides = {}) {
  return {
    notice_id: "n1",
    title: "Janitorial Services for Fort Belvoir",
    naics_code: "561720",
    state: "VA",
    set_aside_code: null,
    set_aside: null,
    response_deadline: "2026-10-20T17:00:00Z",
    ...overrides
  };
}

test("exact NAICS + keyword + state scores high with reasons", () => {
  const result = scoreOpportunity(opp(), profile, now);
  assert.strictEqual(result.score, 80);
  assert.ok(result.reasons.includes("NAICS 561720"));
  assert.ok(result.reasons.some((r) => r.startsWith("keyword: janitorial")));
});

test("related NAICS (same 4 digits) still matches", () => {
  const result = scoreOpportunity(opp({ naics_code: "561790", title: "Pressure washing" }), profile, now);
  assert.ok(result && result.score >= 25);
});

test("no NAICS or keyword match is excluded even in the right state", () => {
  assert.strictEqual(scoreOpportunity(opp({ naics_code: "541512", title: "IT help desk" }), profile, now), null);
});

test("outside the customer's states is excluded; no state on notice is kept", () => {
  assert.strictEqual(scoreOpportunity(opp({ state: "CA" }), profile, now), null);
  assert.ok(scoreOpportunity(opp({ state: null }), profile, now));
  assert.ok(scoreOpportunity(opp({ state: "CA" }), { ...profile, states: [] }, now));
});

test("set-asides the customer doesn't hold are excluded", () => {
  assert.strictEqual(scoreOpportunity(opp({ set_aside_code: "8A", set_aside: "8(a) Set-Aside" }), profile, now), null);
  assert.strictEqual(scoreOpportunity(opp({ set_aside_code: "HZC" }), profile, now), null);
});

test("set-asides the customer holds are boosted; SDVOSB also qualifies for VOSB", () => {
  const sdvosb = scoreOpportunity(opp({ set_aside_code: "SDVOSBC", set_aside: "SDVOSB Set-Aside" }), profile, now);
  assert.strictEqual(sdvosb.score, 95);
  assert.ok(scoreOpportunity(opp({ set_aside_code: "VSA" }), profile, now));
});

test("small business set-asides are open to everyone", () => {
  assert.ok(scoreOpportunity(opp({ set_aside_code: "SBA" }), { ...profile, certifications: [] }, now));
});

test("past deadlines are excluded", () => {
  assert.strictEqual(scoreOpportunity(opp({ response_deadline: "2026-09-01T00:00:00Z" }), profile, now), null);
});

test("rankMatches sorts best first and applies the limit", () => {
  const ranked = rankMatches(
    [
      opp({ notice_id: "low", naics_code: "561790", title: "Floor care" }),
      opp({ notice_id: "high" }),
      opp({ notice_id: "none", naics_code: "111111", title: "Seeds" })
    ],
    profile,
    1,
    now
  );
  assert.deepStrictEqual(ranked.map((r) => r.notice_id), ["high"]);
});

test("form parsers clean user input", () => {
  assert.deepStrictEqual(parseNaics("561720, 561730\n561720 abc 12345"), ["561720", "561730"]);
  assert.deepStrictEqual(parseKeywords("Janitorial, lawn;; ab\nCourier"), ["janitorial", "lawn", "courier"]);
  assert.deepStrictEqual(parseStates("va, md DC texas"), ["VA", "MD", "DC"]);
  assert.deepStrictEqual(parseCertifications(["sdvosb", "bogus"]), ["sdvosb"]);
  assert.deepStrictEqual(parseCertifications("8a"), ["8a"]);
});
