"use strict";

const test = require("node:test");
const assert = require("node:assert");
const config = require("../src/config");
const fmcsa = require("../src/fmcsa");
const { carrierResponse, authorityResponse, basicsResponse, stubFetch } = require("./fixtures");

config.FMCSA_WEB_KEY = "test-key";

test("parseIdentifier reads MC and USDOT numbers", () => {
  assert.deepStrictEqual(fmcsa.parseIdentifier("MC-123456"), { kind: "docket", number: "123456" });
  assert.deepStrictEqual(fmcsa.parseIdentifier("mc 123456"), { kind: "docket", number: "123456" });
  assert.deepStrictEqual(fmcsa.parseIdentifier("DOT 1234567"), { kind: "dot", number: "1234567" });
  assert.deepStrictEqual(fmcsa.parseIdentifier("1234567"), { kind: "dot", number: "1234567" });
  assert.strictEqual(fmcsa.parseIdentifier("abc"), null);
  assert.strictEqual(fmcsa.parseIdentifier("123456789012"), null);
});

test("lookup by MC resolves the USDOT number and normalizes the carrier", async () => {
  const fetchImpl = stubFetch({
    "/carriers/docket-number/987654": { content: [carrierResponse().content] },
    "/carriers/1234567": carrierResponse(),
    "/carriers/1234567/authority": authorityResponse,
    "/carriers/1234567/basics": basicsResponse,
    "/carriers/1234567/oos": { content: [] }
  });

  const s = await fmcsa.lookup("MC-987654", fetchImpl);

  assert.strictEqual(s.dot_number, "1234567");
  assert.strictEqual(s.legal_name, "GOOD TRUCKING LLC");
  assert.strictEqual(s.allowed_to_operate, true);
  assert.strictEqual(s.common_authority, "Active");
  assert.strictEqual(s.insurance.bipd_on_file, 1000);
  assert.strictEqual(s.safety_rating, "Satisfactory");
  assert.strictEqual(s.inspections, 95);
  assert.deepStrictEqual(s.dockets[0], { prefix: "MC", number: "987654", common: "Active", contract: "None", broker: "None", property: true, broker_authorized: false });
  assert.strictEqual(s.basics.length, 2);
  assert.ok(fetchImpl.calls.every((u) => u.includes("webKey=test-key")));
});

test("lookup returns null for an unknown carrier and survives optional endpoint failures", async () => {
  assert.strictEqual(await fmcsa.lookup("7777777", stubFetch({})), null);

  const s = await fmcsa.lookup("1234567", stubFetch({ "/carriers/1234567": carrierResponse() }));
  assert.strictEqual(s.legal_name, "GOOD TRUCKING LLC");
  assert.deepStrictEqual(s.basics, []);
});
