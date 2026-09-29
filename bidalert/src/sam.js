"use strict";

const { SAM_API_KEY } = require("./config");

const SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";
const PAGE_SIZE = 1000;
const MAX_PAGES = 10;

// Notice types worth bidding on. Award notices, special notices,
// justifications and surplus sales are skipped.
const BIDDABLE_TYPES = [
  "solicitation",
  "combined synopsis/solicitation",
  "presolicitation",
  "sources sought"
];

function samDate(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

// "DEPT OF DEFENSE.DEPT OF THE ARMY.W6QK ACC-APG" → "Dept of the Army (Dept of Defense)"
function formatAgency(path) {
  const parts = String(path || "")
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      part
        .toLowerCase()
        .replace(/\b([a-z])/g, (c) => c.toUpperCase())
        .replace(/\b(Of|The|And|For)\b/g, (w) => w.toLowerCase())
    );

  if (!parts.length) {
    return null;
  }

  return parts.length === 1 ? parts[0] : `${parts[1]} (${parts[0]})`;
}

function normalizeOpportunity(item) {
  const place = item.placeOfPerformance || {};
  const deadline = item.responseDeadLine ? new Date(item.responseDeadLine) : null;

  return {
    notice_id: String(item.noticeId || ""),
    title: String(item.title || "").trim(),
    solicitation_number: item.solicitationNumber || null,
    agency: formatAgency(item.fullParentPathName || item.department),
    naics_code: item.naicsCode ? String(item.naicsCode) : null,
    psc_code: item.classificationCode || null,
    notice_type: item.type || item.baseType || null,
    set_aside_code: item.typeOfSetAside || null,
    set_aside: item.typeOfSetAsideDescription || null,
    posted_date: item.postedDate ? String(item.postedDate).slice(0, 10) : null,
    response_deadline:
      deadline && !Number.isNaN(deadline.getTime()) ? deadline.toISOString() : null,
    state: place.state?.code || null,
    city: place.city?.name || null,
    ui_link:
      item.uiLink ||
      (item.noticeId ? `https://sam.gov/opp/${item.noticeId}/view` : null),
    raw: item
  };
}

function isBiddable(opportunity) {
  return BIDDABLE_TYPES.includes(String(opportunity.notice_type || "").toLowerCase());
}

/*
  One SAM.gov call returns up to 1,000 notices, so a whole day of postings
  is usually 1–3 calls. Personal API keys are limited to ~1,000 calls a
  day, which is why we download once and match every customer locally.
*/
async function fetchPostedOn(date, fetchImpl = fetch) {
  if (!SAM_API_KEY) {
    throw new Error("SAM_API_KEY is not configured");
  }

  const all = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      api_key: SAM_API_KEY,
      postedFrom: samDate(date),
      postedTo: samDate(date),
      limit: String(PAGE_SIZE),
      offset: String(page * PAGE_SIZE)
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    let response;

    try {
      response = await fetchImpl(`${SEARCH_URL}?${params}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();

    if (!response.ok) {
      throw new Error(`SAM.gov HTTP ${response.status}: ${text.slice(0, 300)}`);
    }

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`SAM.gov returned non-JSON: ${text.slice(0, 200)}`);
    }

    const items = Array.isArray(data.opportunitiesData) ? data.opportunitiesData : [];
    all.push(...items);

    const total = Number(data.totalRecords || 0);

    if (items.length < PAGE_SIZE || all.length >= total) {
      break;
    }
  }

  return all
    .map(normalizeOpportunity)
    .filter((opportunity) => opportunity.notice_id && isBiddable(opportunity));
}

module.exports = {
  fetchPostedOn,
  normalizeOpportunity,
  formatAgency,
  isBiddable,
  samDate
};
