"use strict";

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const db = require("../src/db");
const billing = require("../src/billing");

test("webhook signatures are verified", () => {
  const body = '{"type":"ping"}';
  const ts = 1790000000;
  const sig = crypto.createHmac("sha256", "whsec_x").update(`${ts}.${body}`).digest("hex");
  assert.ok(billing.verifySignature(body, `t=${ts},v1=${sig}`, "whsec_x", ts));
  assert.ok(!billing.verifySignature(body, `t=${ts},v1=${sig}`, "whsec_y", ts));
});

test("only this app's Stripe objects are acted on (shared account with InteliBid and BidAlert)", async () => {
  const writes = [];
  db.query = async (sql, params) => {
    writes.push({ sql, params });
    return { rows: [] };
  };

  // BidAlert session (metadata.user_id) and InteliBid session (company_id): ignored.
  for (const metadata of [{ user_id: "u1" }, { company_id: "c1", plan_id: "professional" }]) {
    await billing.handleEvent({ type: "checkout.session.completed", data: { object: { mode: "subscription", metadata, client_reference_id: "x" } } });
  }

  assert.strictEqual(writes.length, 0);

  await billing.handleEvent({
    type: "checkout.session.completed",
    data: { object: { mode: "subscription", metadata: { app: billing.APP_TAG, cv_user_id: "u9" }, customer: "cus", subscription: "sub" } }
  });

  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].params[0], "u9");
});
