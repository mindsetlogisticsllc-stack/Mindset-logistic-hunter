"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { normalize } = require("../src/fmcsa");
const { evaluate } = require("../src/vet");
const { carrierResponse, authorityResponse, basicsResponse } = require("./fixtures");

function snap(overrides = {}, extra = {}) {
  return normalize({
    carrier: carrierResponse(overrides).content.carrier,
    authorities: authorityResponse.content,
    basics: basicsResponse.content,
    ...extra
  });
}

const codes = (r) => r.flags.map((f) => f.code);

test("a clean carrier is approved", () => {
  const r = evaluate(snap());
  assert.strictEqual(r.decision, "approve");
  assert.strictEqual(r.score, 100);
  assert.deepStrictEqual(codes(r), ["clean"]);
});

test("not found, not allowed, inactive, out of service and no insurance are rejected", () => {
  assert.strictEqual(evaluate(null).decision, "reject");
  assert.ok(codes(evaluate(snap({ allowedToOperate: "N" }))).includes("not_allowed"));
  assert.ok(codes(evaluate(snap({ statusCode: "I" }))).includes("inactive_dot"));
  assert.ok(codes(evaluate(snap({ oosDate: "2026-09-01" }))).includes("out_of_service"));
  assert.ok(codes(evaluate(snap({ bipdInsuranceOnFile: "0" }))).includes("no_liability_insurance"));
  assert.strictEqual(evaluate(snap({ safetyRating: "U" })).decision, "reject");
});

test("broker-only authority is flagged as a double-brokering risk", () => {
  const r = evaluate(snap({ commonAuthorityStatus: "N", brokerAuthorityStatus: "A" }));
  assert.strictEqual(r.decision, "reject");
  assert.ok(codes(r).includes("broker_only"));
});

test("warning signs send a carrier to review, not reject", () => {
  const conditional = evaluate(snap({ safetyRating: "C" }));
  assert.strictEqual(conditional.decision, "review");
  assert.ok(codes(conditional).includes("conditional_rating"));

  const newAuthority = evaluate(snap({ vehicleInsp: 0, driverInsp: 0 }));
  assert.strictEqual(newAuthority.decision, "review");
  assert.ok(codes(newAuthority).includes("no_inspection_history"));

  const alerts = evaluate(
    snap({}, { basics: [{ basic: { basicsType: { basicsShortDesc: "Unsafe Driving" }, exceededFMCSAInterventionThreshold: "Y" } }] })
  );
  assert.ok(codes(alerts).includes("basic_alerts"));

  assert.ok(codes(evaluate(snap({ cargoInsuranceOnFile: "0" }))).includes("no_cargo_insurance"));
  assert.ok(codes(evaluate(snap({ vehicleOosRate: 60 }))).includes("high_vehicle_oos"));
  assert.ok(codes(evaluate(snap({ totalPowerUnits: 0 }))).includes("no_power_units"));
});
