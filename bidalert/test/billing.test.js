"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const { verifySignature, hasAccess } = require("../src/billing");

const secret = "whsec_test";
const body = '{"type":"ping"}';

function sign(ts, payload = body, key = secret) {
  return crypto.createHmac("sha256", key).update(`${ts}.${payload}`).digest("hex");
}

test("accepts a correctly signed Stripe webhook", () => {
  const ts = 1790000000;
  assert.ok(verifySignature(body, `t=${ts},v1=${sign(ts)}`, secret, ts));
});

test("rejects a tampered body, wrong secret, or stale timestamp", () => {
  const ts = 1790000000;
  assert.ok(!verifySignature('{"type":"evil"}', `t=${ts},v1=${sign(ts)}`, secret, ts));
  assert.ok(!verifySignature(body, `t=${ts},v1=${sign(ts, body, "other")}`, secret, ts));
  assert.ok(!verifySignature(body, `t=${ts},v1=${sign(ts)}`, secret, ts + 3600));
  assert.ok(!verifySignature(body, undefined, secret, ts));
});

test("only live subscription statuses have access", () => {
  for (const status of ["active", "trialing", "past_due"]) {
    assert.ok(hasAccess({ status }));
  }

  for (const status of ["none", "canceled", "incomplete", "unpaid"]) {
    assert.ok(!hasAccess({ status }));
  }
});
