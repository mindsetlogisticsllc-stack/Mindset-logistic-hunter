"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { canonical, hashRecord, verifyRecord } = require("../src/record");

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  dot_number: "1234567",
  legal_name: "GOOD TRUCKING LLC",
  decision: "approve",
  score: 100,
  flags: [{ level: "info", code: "clean", text: "ok" }],
  snapshot: { b: 1, a: { y: 2, x: [1, null] } },
  load_reference: "Load 4471",
  checked_by: "ops@example.com",
  created_at: new Date("2026-10-07T12:00:00.123Z")
};

test("canonical JSON ignores key order", () => {
  assert.strictEqual(canonical({ b: 1, a: 2 }), canonical({ a: 2, b: 1 }));
});

test("a record verifies, and any edit breaks it", () => {
  const row = { ...base, record_hash: hashRecord(base) };
  assert.ok(verifyRecord(row));

  // Same data read back from Postgres (keys reordered, date as Date) still verifies.
  assert.ok(verifyRecord({ ...row, snapshot: { a: { x: [1, null], y: 2 }, b: 1 } }));

  assert.ok(!verifyRecord({ ...row, decision: "reject" }));
  assert.ok(!verifyRecord({ ...row, snapshot: { ...row.snapshot, b: 2 } }));
  assert.ok(!verifyRecord({ ...row, created_at: new Date("2026-10-07T12:00:01.123Z") }));
  assert.ok(!verifyRecord({ ...base }));
});
