"use strict";

const crypto = require("crypto");

/*
  Proof-of-vetting records. The hash covers everything the broker relied
  on (carrier data as fetched, decision, reasons, who checked, which load,
  when). Anyone can recompute it on the public /verify page; if a single
  character of the stored record were changed the hash would not match.
*/

// Stable JSON: object keys sorted so the same record always hashes the same.
function canonical(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value === undefined ? null : value);
}

function recordFields(row) {
  return {
    id: row.id,
    dot_number: row.dot_number,
    legal_name: row.legal_name,
    decision: row.decision,
    score: row.score,
    flags: row.flags,
    snapshot: row.snapshot,
    load_reference: row.load_reference || "",
    checked_by: row.checked_by || "",
    created_at: new Date(row.created_at).toISOString()
  };
}

function hashRecord(row) {
  return crypto.createHash("sha256").update(canonical(recordFields(row))).digest("hex");
}

function verifyRecord(row) {
  return Boolean(row?.record_hash) && hashRecord(row) === row.record_hash;
}

module.exports = { canonical, hashRecord, verifyRecord };
