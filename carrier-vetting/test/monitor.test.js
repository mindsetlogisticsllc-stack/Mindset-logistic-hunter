"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { normalize } = require("../src/fmcsa");
const { diff } = require("../src/monitor");
const { carrierResponse } = require("./fixtures");

const snap = (o) => normalize({ carrier: carrierResponse(o).content.carrier });

test("no changes means no alert", () => {
  assert.deepStrictEqual(diff(snap(), snap()), []);
});

test("losing authority, insurance or going out of service is serious", () => {
  const items = diff(snap(), snap({ commonAuthorityStatus: "I", bipdInsuranceOnFile: "0", oosDate: "2026-10-01" }));
  const labels = items.map((i) => i.label);

  assert.ok(labels.includes("Common authority"));
  assert.ok(labels.includes("Liability insurance on file ($K)"));
  assert.ok(labels.includes("Out-of-service order"));
  assert.ok(items.every((i) => i.serious));
});

test("an address change is reported but not serious", () => {
  const items = diff(snap(), snap({ phyStreet: "9 OTHER RD" }));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].serious, false);
});
