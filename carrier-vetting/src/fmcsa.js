"use strict";

const config = require("./config");

/*
  FMCSA QCMobile API (https://mobile.fmcsa.dot.gov/QCDevsite).
  Free; needs a web key from the developer site (Login.gov sign-in).
  Every response is wrapped as { content: ... }, where content is an object
  for single lookups and an array for lists. Field names follow FMCSA's
  published API elements.
*/
const BASE = "https://mobile.fmcsa.dot.gov/qc/services";

class FmcsaError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

// "MC-123456", "mc 123456", "DOT 1234567", "1234567" -> { kind, number }
function parseIdentifier(input) {
  const raw = String(input || "").trim();
  const number = digits(raw);

  if (!number || number.length > 8) {
    return null;
  }

  if (/^\s*(mc|mx|ff)/i.test(raw)) {
    return { kind: "docket", number };
  }

  return { kind: "dot", number };
}

async function call(path, fetchImpl = fetch) {
  if (!config.FMCSA_WEB_KEY) {
    throw new FmcsaError("FMCSA_WEB_KEY is not configured", 503);
  }

  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}webKey=${encodeURIComponent(config.FMCSA_WEB_KEY)}`;
  const response = await fetchImpl(url, { headers: { Accept: "application/json" } });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new FmcsaError(`FMCSA HTTP ${response.status}`, response.status);
  }

  const body = await response.json().catch(() => ({}));
  return body?.content ?? null;
}

function asList(content) {
  if (!content) {
    return [];
  }

  return Array.isArray(content) ? content : [content];
}

function yes(value) {
  return String(value || "").toUpperCase() === "Y";
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

const AUTHORITY_STATUS = { A: "Active", I: "Inactive", N: "None" };
const RATING = { S: "Satisfactory", C: "Conditional", U: "Unsatisfactory" };

function authorityText(code) {
  return AUTHORITY_STATUS[String(code || "").toUpperCase()] || (code ? String(code) : "None");
}

/*
  Turn the raw QCMobile pieces into the flat snapshot the scoring rules,
  the proof record and the monitor all use. Unknown/missing fields stay
  null rather than being guessed.
*/
function normalize({ carrier, authorities = [], basics = [], oos = [] }) {
  if (!carrier) {
    return null;
  }

  const dockets = authorities
    .map((a) => a?.carrierAuthority || a)
    .filter(Boolean)
    .map((a) => ({
      prefix: a.prefix || "MC",
      number: a.docketNumber != null ? String(a.docketNumber) : null,
      common: authorityText(a.commonAuthorityStatus),
      contract: authorityText(a.contractAuthorityStatus),
      broker: authorityText(a.brokerAuthorityStatus),
      property: yes(a.authorizedForProperty),
      broker_authorized: yes(a.authorizedForBroker)
    }));

  const basicList = basics
    .map((b) => b?.basic || b)
    .filter(Boolean)
    .map((b) => ({
      name: b.basicsType?.basicsShortDesc || b.basicsType?.basicsLongDesc || "BASIC",
      percentile: b.basicsPercentile != null && b.basicsPercentile !== "" ? String(b.basicsPercentile) : null,
      alert: yes(b.exceededFMCSAInterventionThreshold)
    }));

  const oosList = oos
    .map((o) => o?.oos || o)
    .filter(Boolean)
    .map((o) => ({
      date: o.oosDate || null,
      reason: o.oosReasonDescription || o.oosReason || null
    }));

  const bipdOnFile = money(carrier.bipdInsuranceOnFile);
  const bipdRequired = yes(carrier.bipdInsuranceRequired);

  return {
    dot_number: String(carrier.dotNumber ?? ""),
    legal_name: carrier.legalName || "",
    dba_name: carrier.dbaName || "",
    status_code: carrier.statusCode || null,
    allowed_to_operate: carrier.allowedToOperate != null ? yes(carrier.allowedToOperate) : null,
    common_authority: authorityText(carrier.commonAuthorityStatus),
    contract_authority: authorityText(carrier.contractAuthorityStatus),
    broker_authority: authorityText(carrier.brokerAuthorityStatus),
    dockets,
    insurance: {
      bipd_on_file: bipdOnFile,
      bipd_required: bipdRequired,
      bipd_required_amount: money(carrier.bipdRequiredAmount),
      cargo_on_file: money(carrier.cargoInsuranceOnFile),
      cargo_required: yes(carrier.cargoInsuranceRequired),
      bond_on_file: money(carrier.bondInsuranceOnFile),
      bond_required: yes(carrier.bondInsuranceRequired)
    },
    safety_rating: RATING[String(carrier.safetyRating || "").toUpperCase()] || null,
    safety_rating_date: carrier.safetyRatingDate || null,
    mcs150_outdated: carrier.mcs150Outdated != null ? yes(carrier.mcs150Outdated) : null,
    oos_date: carrier.oosDate || null,
    out_of_service: oosList,
    vehicle_oos_rate: carrier.vehicleOosRate != null ? Number(carrier.vehicleOosRate) : null,
    vehicle_oos_national: carrier.vehicleOosRateNationalAverage != null ? Number(carrier.vehicleOosRateNationalAverage) : null,
    driver_oos_rate: carrier.driverOosRate != null ? Number(carrier.driverOosRate) : null,
    driver_oos_national: carrier.driverOosRateNationalAverage != null ? Number(carrier.driverOosRateNationalAverage) : null,
    inspections: Number(carrier.vehicleInsp || 0) + Number(carrier.driverInsp || 0),
    crashes: Number(carrier.crashTotal || 0),
    fatal_crashes: Number(carrier.fatalCrash || 0),
    power_units: carrier.totalPowerUnits != null ? Number(carrier.totalPowerUnits) : null,
    drivers: carrier.totalDrivers != null ? Number(carrier.totalDrivers) : null,
    address: {
      street: carrier.phyStreet || "",
      city: carrier.phyCity || "",
      state: carrier.phyState || "",
      zip: carrier.phyZipcode || ""
    },
    basics: basicList,
    source: "FMCSA QCMobile",
    fetched_at: new Date().toISOString()
  };
}

async function resolveDot(identifier, fetchImpl) {
  if (identifier.kind === "dot") {
    return identifier.number;
  }

  const content = asList(await call(`/carriers/docket-number/${identifier.number}`, fetchImpl));
  const carrier = content.map((c) => c?.carrier || c).find((c) => c?.dotNumber);
  return carrier ? String(carrier.dotNumber) : null;
}

// Full profile for one carrier, or null if FMCSA has no such carrier.
async function lookup(input, fetchImpl = fetch) {
  const identifier = typeof input === "object" ? input : parseIdentifier(input);

  if (!identifier) {
    return null;
  }

  const dot = await resolveDot(identifier, fetchImpl);

  if (!dot) {
    return null;
  }

  const carrierContent = await call(`/carriers/${dot}`, fetchImpl);
  const carrier = carrierContent?.carrier || (Array.isArray(carrierContent) ? carrierContent[0]?.carrier : carrierContent);

  if (!carrier || !carrier.dotNumber) {
    return null;
  }

  // Extra detail is best effort: a failure here shouldn't block the check.
  const optional = async (path) => {
    try {
      return asList(await call(path, fetchImpl));
    } catch (err) {
      console.warn(`FMCSA ${path} failed:`, err.message);
      return [];
    }
  };

  const [authorities, basics, oos] = await Promise.all([
    optional(`/carriers/${dot}/authority`),
    optional(`/carriers/${dot}/basics`),
    optional(`/carriers/${dot}/oos`)
  ]);

  return normalize({ carrier, authorities, basics, oos });
}

module.exports = {
  FmcsaError,
  parseIdentifier,
  normalize,
  lookup,
  configured: () => Boolean(config.FMCSA_WEB_KEY)
};
