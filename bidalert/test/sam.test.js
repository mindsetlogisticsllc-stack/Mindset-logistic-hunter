"use strict";

const test = require("node:test");
const assert = require("node:assert");

process.env.SAM_API_KEY = "test-key";
const sam = require("../src/sam");

function notice(id, type = "Solicitation") {
  return {
    noticeId: id,
    title: `Notice ${id}`,
    type,
    naicsCode: 561720,
    postedDate: "2026-09-29",
    responseDeadLine: "2026-10-15T14:00:00-04:00",
    typeOfSetAside: "SBA",
    typeOfSetAsideDescription: "Total Small Business Set-Aside (FAR 19.5)",
    fullParentPathName: "DEPT OF DEFENSE.DEPT OF THE ARMY",
    placeOfPerformance: { state: { code: "VA" }, city: { name: "Fort Belvoir" } },
    uiLink: `https://sam.gov/opp/${id}/view`
  };
}

test("samDate formats MM/dd/yyyy", () => {
  assert.strictEqual(sam.samDate("2026-09-05"), "09/05/2026");
});

test("formats agency paths readably", () => {
  assert.strictEqual(sam.formatAgency("DEPT OF DEFENSE.DEPT OF THE ARMY.W6QK ACC-APG"), "Dept of the Army (Dept of Defense)");
  assert.strictEqual(sam.formatAgency("GENERAL SERVICES ADMINISTRATION"), "General Services Administration");
  assert.strictEqual(sam.formatAgency(""), null);
});

test("normalizes a SAM.gov notice", () => {
  const o = sam.normalizeOpportunity(notice("abc"));
  assert.strictEqual(o.notice_id, "abc");
  assert.strictEqual(o.naics_code, "561720");
  assert.strictEqual(o.state, "VA");
  assert.strictEqual(o.city, "Fort Belvoir");
  assert.strictEqual(o.set_aside_code, "SBA");
  assert.strictEqual(o.response_deadline, "2026-10-15T18:00:00.000Z");
});

test("fetchPostedOn pages through results and drops non-biddable notices", async () => {
  const calls = [];
  const pages = [
    { totalRecords: 1002, opportunitiesData: [...Array(999)].map((_, i) => notice(`a${i}`)).concat(notice("award", "Award Notice")) },
    { totalRecords: 1002, opportunitiesData: [notice("b1", "Sources Sought"), notice("b2", "Special Notice")] }
  ];

  const fakeFetch = async (url) => {
    calls.push(new URL(url));
    const body = pages[calls.length - 1];
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };

  const result = await sam.fetchPostedOn("2026-09-29", fakeFetch);

  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].searchParams.get("postedFrom"), "09/29/2026");
  assert.strictEqual(calls[1].searchParams.get("offset"), "1000");
  assert.strictEqual(result.length, 1000);
  assert.ok(!result.some((o) => o.notice_id === "award" || o.notice_id === "b2"));
  assert.ok(result.some((o) => o.notice_id === "b1"));
});

test("fetchPostedOn surfaces SAM.gov errors", async () => {
  const fakeFetch = async () => ({ ok: false, status: 429, text: async () => "rate limited" });
  await assert.rejects(sam.fetchPostedOn("2026-09-29", fakeFetch), /SAM.gov HTTP 429/);
});
