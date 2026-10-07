"use strict";

/*
  Turns an FMCSA snapshot into a decision a broker can act on:
    approve  - nothing concerning found
    review   - something worth a phone call before tendering
    reject   - do not tender
  Each flag carries plain-English text so the decision is explainable and
  the same reasons appear on the proof record.

  This is decision support, not a guarantee: FMCSA data can lag, and
  identity fraud (someone impersonating a real carrier) can only be caught
  by also confirming contact details through FMCSA-listed phone numbers.
*/

const WEIGHTS = { reject: 100, review: 25, info: 0 };

function flag(level, code, text) {
  return { level, code, text };
}

function isActive(status) {
  return String(status || "").toLowerCase() === "active";
}

function evaluate(snapshot) {
  const flags = [];

  if (!snapshot) {
    return { decision: "reject", score: 0, flags: [flag("reject", "not_found", "No carrier with this number was found at FMCSA.")] };
  }

  // --- Legal to operate -------------------------------------------------
  if (snapshot.allowed_to_operate === false) {
    flags.push(flag("reject", "not_allowed", "FMCSA lists this carrier as NOT allowed to operate."));
  }

  if (snapshot.status_code && String(snapshot.status_code).toUpperCase() !== "A") {
    flags.push(flag("reject", "inactive_dot", "The USDOT number is not active."));
  }

  const hasForHireAuthority = isActive(snapshot.common_authority) || isActive(snapshot.contract_authority);

  if (!hasForHireAuthority) {
    flags.push(
      isActive(snapshot.broker_authority)
        ? flag("reject", "broker_only", "This company has broker authority only, not carrier authority. Tendering a load here is a double-brokering risk.")
        : flag("reject", "no_authority", "No active for-hire operating authority (common or contract).")
    );
  }

  // --- Out of service -----------------------------------------------------
  if (snapshot.oos_date || (snapshot.out_of_service || []).length) {
    const reason = snapshot.out_of_service?.[0]?.reason;
    flags.push(flag("reject", "out_of_service", `An out-of-service order is on file${reason ? `: ${reason}` : ""}.`));
  }

  // --- Insurance ----------------------------------------------------------
  const ins = snapshot.insurance || {};

  if (hasForHireAuthority && ins.bipd_on_file <= 0) {
    flags.push(flag("reject", "no_liability_insurance", "No liability (BIPD) insurance is on file with FMCSA."));
  } else if (ins.bipd_required_amount > 0 && ins.bipd_on_file > 0 && ins.bipd_on_file < ins.bipd_required_amount) {
    flags.push(flag("review", "liability_below_required", `Liability insurance on file ($${ins.bipd_on_file.toLocaleString()}K) is below the required amount.`));
  }

  if (ins.cargo_required && ins.cargo_on_file <= 0) {
    flags.push(flag("review", "no_cargo_insurance", "Cargo insurance is required but none is on file. Ask for a certificate of insurance."));
  }

  // --- Safety -------------------------------------------------------------
  if (snapshot.safety_rating === "Unsatisfactory") {
    flags.push(flag("reject", "unsatisfactory_rating", "FMCSA safety rating is Unsatisfactory."));
  } else if (snapshot.safety_rating === "Conditional") {
    flags.push(flag("review", "conditional_rating", "FMCSA safety rating is Conditional. Since Montgomery v. Caribe (2026) brokers can be sued for negligent selection; document why this carrier is acceptable."));
  }

  const alerts = (snapshot.basics || []).filter((b) => b.alert);

  if (alerts.length) {
    flags.push(flag("review", "basic_alerts", `Over FMCSA intervention threshold in: ${alerts.map((b) => b.name).join(", ")}.`));
  }

  if (snapshot.vehicle_oos_rate != null && snapshot.vehicle_oos_national != null && snapshot.inspections >= 5 &&
      snapshot.vehicle_oos_rate > snapshot.vehicle_oos_national * 1.5) {
    flags.push(flag("review", "high_vehicle_oos", `Vehicle out-of-service rate ${snapshot.vehicle_oos_rate}% is well above the national average (${snapshot.vehicle_oos_national}%).`));
  }

  if (snapshot.fatal_crashes > 0) {
    flags.push(flag("review", "fatal_crash", `${snapshot.fatal_crashes} fatal crash(es) in FMCSA's 24-month record.`));
  }

  // --- Fraud signals ------------------------------------------------------
  if (snapshot.inspections === 0 && hasForHireAuthority) {
    flags.push(flag("review", "no_inspection_history", "No roadside inspections on record. New or rarely-used authority is a common fraud pattern; verify by calling the FMCSA-listed phone number."));
  }

  if (snapshot.mcs150_outdated === true) {
    flags.push(flag("review", "mcs150_outdated", "The carrier's MCS-150 registration update is overdue."));
  }

  if (snapshot.power_units === 0) {
    flags.push(flag("review", "no_power_units", "Zero power units reported. Confirm they actually own or lease trucks."));
  }

  if (!flags.length) {
    flags.push(flag("info", "clean", "Active authority, insurance on file, no out-of-service orders or safety alerts found."));
  }

  const penalty = flags.reduce((sum, f) => sum + WEIGHTS[f.level], 0);
  const score = Math.max(0, 100 - penalty);
  const decision = flags.some((f) => f.level === "reject") ? "reject" : flags.some((f) => f.level === "review") ? "review" : "approve";

  return { decision, score, flags };
}

module.exports = { evaluate };
