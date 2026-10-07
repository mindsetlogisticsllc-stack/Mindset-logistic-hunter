"use strict";

// Shaped like FMCSA QCMobile responses ({ content: ... }).
function carrierResponse(overrides = {}) {
  return {
    content: {
      carrier: {
        dotNumber: 1234567,
        legalName: "GOOD TRUCKING LLC",
        dbaName: "",
        statusCode: "A",
        allowedToOperate: "Y",
        commonAuthorityStatus: "A",
        contractAuthorityStatus: "N",
        brokerAuthorityStatus: "N",
        bipdInsuranceOnFile: "1000",
        bipdInsuranceRequired: "Y",
        bipdRequiredAmount: "750",
        cargoInsuranceOnFile: "100",
        cargoInsuranceRequired: "Y",
        bondInsuranceOnFile: "0",
        bondInsuranceRequired: "N",
        safetyRating: "S",
        safetyRatingDate: "2024-03-01",
        mcs150Outdated: "N",
        oosDate: null,
        vehicleOosRate: 18.2,
        vehicleOosRateNationalAverage: 22.26,
        driverOosRate: 4.1,
        driverOosRateNationalAverage: 6.67,
        vehicleInsp: 40,
        driverInsp: 55,
        crashTotal: 1,
        fatalCrash: 0,
        totalPowerUnits: 25,
        totalDrivers: 28,
        phyStreet: "1 MAIN ST",
        phyCity: "DALLAS",
        phyState: "TX",
        phyZipcode: "75201",
        ...overrides
      }
    }
  };
}

const authorityResponse = {
  content: [{ carrierAuthority: { prefix: "MC", docketNumber: 987654, commonAuthorityStatus: "A", contractAuthorityStatus: "N", brokerAuthorityStatus: "N", authorizedForProperty: "Y", authorizedForBroker: "N" } }]
};

const basicsResponse = {
  content: [
    { basic: { basicsType: { basicsShortDesc: "Unsafe Driving" }, basicsPercentile: "40", exceededFMCSAInterventionThreshold: "N" } },
    { basic: { basicsType: { basicsShortDesc: "HOS Compliance" }, basicsPercentile: "12", exceededFMCSAInterventionThreshold: "N" } }
  ]
};

function stubFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    const path = new URL(url).pathname.replace("/qc/services", "");
    const body = routes[path];

    if (body === undefined) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    return { ok: true, status: 200, json: async () => body };
  };
  fn.calls = calls;
  return fn;
}

module.exports = { carrierResponse, authorityResponse, basicsResponse, stubFetch };
