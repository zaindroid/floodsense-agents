// One replayed run of the agents service, copied from its own output, plus the
// seed series behind it. Shared by both mock pages. Nothing here is live.
"use strict";

window.EVENT = {
  id: "EMSR773",
  place: "Valencia",
  date: "29 October 2024",
  replay: "29 Oct 2024, 18:00 UTC",
  portfolio: "demo-insurer",
  question: "Why are our Valencia sites at risk?",
};

// Hour of day, UTC, 29 October 2024.
window.RAIN_CHIVA =
  { 9: 18, 10: 35, 11: 52, 12: 70, 13: 88, 14: 96, 15: 74, 16: 58, 17: 31, 18: 12 };
window.RAIN_TURIS = { 13: 20, 14: 42, 15: 71, 16: 185, 17: 60, 18: 15 };
window.DISCHARGE = { 12: 6, 13: 9, 14: 40, 15: 310, 16: 1686, 17: 2282 };
window.GAUGE_LOST = 18;
window.ES_ALERT = 19 + 11 / 60;

// Ten policies. Seven fall inside the Copernicus footprint.
window.SITES = [
  { policy: "P-1003", site: "S-003", segment: "retail", sum: 6500000, inside: true },
  { policy: "P-1001", site: "S-001", segment: "warehouse", sum: 4200000, inside: true },
  { policy: "P-1005", site: "S-005", segment: "industrial", sum: 3100000, inside: true },
  { policy: "P-1009", site: "S-009", segment: "industrial", sum: 2700000, inside: true },
  { policy: "P-1006", site: "S-006", segment: "healthcare", sum: 2400000, inside: true },
  { policy: "P-1002", site: "S-002", segment: "retail", sum: 1900000, inside: true },
  { policy: "P-1004", site: "S-004", segment: "retail", sum: 800000, inside: true },
  { policy: "P-1008", site: "S-008", segment: "office", sum: 9000000, inside: false },
  { policy: "P-1010", site: "S-010", segment: "hospitality", sum: 1500000, inside: false },
  { policy: "P-1007", site: "S-007", segment: "industrial", sum: 1200000, inside: false },
];

window.SEGMENTS = [
  { name: "Retail", policies: 3, sum: 9200000 },
  { name: "Industrial", policies: 2, sum: 5800000 },
  { name: "Warehouse", policies: 1, sum: 4200000 },
  { name: "Healthcare", policies: 1, sum: 2400000 },
];

window.TOTALS = { policies: 7, sum: 21600000, ofSites: 10, segments: 4 };

// Three steps for the plain view, four hypotheses for the analyst view. Same
// chain, different grain.
window.STEPS = [
  {
    n: 1,
    head: "It rained harder than the hills could take",
    figure: "534 mm",
    unit: "in ten hours at Chiva",
    plain:
      "More than half a metre of rain on the catchment above the ravine. " +
      "One hour at Turís brought 185 mm on its own.",
    viz: "rain",
  },
  {
    n: 2,
    head: "The ravine filled, then the gauge stopped",
    figure: "380×",
    unit: "rise in five hours",
    plain:
      "The Poyo ravine went from 6 to 2,282 cubic metres a second. " +
      "At 18:00 the gauge stopped reporting, so the peak is the last reading, not the real maximum.",
    viz: "river",
  },
  {
    n: 3,
    head: "The water reached your sites",
    figure: "7 of 10",
    unit: "sites inside the flooded area",
    plain:
      "The flooded area is mapped from satellite by the EU's emergency service. " +
      "Seven of your ten sites fall inside it.",
    viz: "sites",
  },
];

window.CHAIN = [
  {
    id: "H1",
    link: "rain to catchment",
    statement: "Extreme rainfall fell over the Poyo ravine catchment",
    status: "supported",
    checks: ["an hour at or above 20 mm", "lasted more than one hour", "started before the peak"],
    claims: ["C1", "C2", "C3"],
  },
  {
    id: "H2",
    link: "catchment to river",
    statement: "Runoff produced an extreme discharge in the Barranco del Poyo",
    status: "supported",
    checks: ["rose at least tenfold", "daily series agrees", "a warning was issued"],
    claims: ["C4", "C5", "C6", "C7"],
  },
  {
    id: "H3",
    link: "river to site",
    statement: "The overflow reached built-up areas mapped by Copernicus EMS",
    status: "supported",
    checks: ["contains insured sites", "not the whole region", "sites carry coordinates"],
    claims: ["C8"],
  },
  {
    id: "H4",
    link: "site to exposure",
    statement: "7 insured sites are exposed",
    status: "supported",
    checks: ["deterministic join, no counter-check needed"],
    claims: ["C9", "C10"],
  },
];

window.ANSWER = [
  { t: "Extreme rainfall fell over the Poyo ravine catchment" },
  { c: ["C1", "C2", "C3"] },
  { t: ". Runoff produced an extreme discharge in the Barranco del Poyo" },
  { c: ["C4", "C5", "C6", "C7"] },
  { t: ". The overflow reached built-up areas mapped by Copernicus EMS" },
  { c: ["C8"] },
  { t: ". Seven insured sites sit inside the footprint, 21.6m EUR sum insured" },
  { c: ["C9", "C10"] },
  { t: "." },
];

window.CLAIMS = {
  C1: {
    kind: "number",
    text: "Point chiva recorded 534 mm of rain over 10 hours between 09:00 and 18:00 UTC, peak hour 96 mm.",
    figures: "534 mm, 10 h, 96 mm/h",
    view: "floodsense_seed.hazard_timeline",
    hour: 14,
  },
  C2: {
    kind: "number",
    text: "Point turis recorded 393 mm of rain over 6 hours between 13:00 and 18:00 UTC, peak hour 185 mm.",
    figures: "393 mm, 6 h, 185 mm/h",
    view: "floodsense_seed.hazard_timeline",
    hour: 16,
  },
  C3: {
    kind: "fact",
    text: "Warning level red was in force for point chiva from 09:00 UTC.",
    figures: "red, from 09:00 UTC",
    view: "floodsense_seed.hazard_timeline",
    hour: 9,
  },
  C4: {
    kind: "number",
    text: "Discharge at poyo-ribaroja reached 2282 m³/s at 17:00 UTC, from 6 m³/s at 12:00 UTC.",
    figures: "2,282 m³/s from 6 m³/s",
    view: "floodsense_seed.hazard_timeline",
    hour: 17,
  },
  C5: {
    kind: "fact",
    text: "The poyo-ribaroja series has no discharge value from 18:00 UTC on. The gauge went out during the peak.",
    figures: "no value from 18:00 UTC",
    view: "floodsense_seed.hazard_timeline",
    hour: 18,
  },
  C6: {
    kind: "number",
    text: "Daily discharge for poyo-ribaroja was 2100 m³/s on 29 October, up from 3 m³/s on 28 October.",
    figures: "2,100 m³/s from 3 m³/s",
    view: "floodsense_seed.discharge_daily",
    hour: null,
  },
  C7: {
    kind: "cause",
    text: "Rain began at 09:00 UTC and the discharge peak followed at 17:00 UTC, consistent with catchment runoff driving the river response.",
    figures: "8 h lag",
    view: "floodsense_seed.hazard_timeline",
    hour: 17,
  },
  C8: {
    kind: "number",
    text: "The Copernicus EMS footprint (EMSR773) covers 7 insured sites across 4 segments.",
    figures: "7 sites, 4 segments",
    view: "floodsense_seed.exposure_join",
    hour: null,
  },
  C9: {
    kind: "number",
    text: "7 policies sit inside the mapped footprint, sum insured 21,600,000 EUR. The largest is P-1003, retail, 6,500,000 EUR.",
    figures: "7 policies, 21,600,000 EUR",
    view: "floodsense_seed.exposure_join",
    hour: null,
  },
  C10: {
    kind: "number",
    text: "The most exposed segment is retail: 3 policies, 9,200,000 EUR sum insured.",
    figures: "3 policies, 9,200,000 EUR",
    view: "floodsense_seed.exposure_join",
    hour: null,
  },
};

window.VIEWS = {
  "floodsense_seed.hazard_timeline": {
    publisher: "AEMET, SAIH Júcar (CHJ)",
    licence: "AEMET OpenData terms (to confirm), SAIH Júcar (to verify)",
    settled: false,
    sql:
      "SELECT point_id, ts_utc, rain_mm, discharge_m3s, warning_level\n" +
      "  FROM floodsense_seed.hazard_timeline\n" +
      " WHERE ts_utc BETWEEN '2024-10-28T00:00:00Z' AND '2024-10-30T23:59:59Z'",
  },
  "floodsense_seed.discharge_daily": {
    publisher: "Open-Meteo / GloFAS",
    licence: "CC BY 4.0",
    settled: true,
    sql:
      "SELECT point_id, date, discharge_m3s, source\n" +
      "  FROM floodsense_seed.discharge_daily\n" +
      " WHERE point_id IN ('poyo-ribaroja')\n" +
      "   AND date BETWEEN '2024-10-28' AND '2024-10-30'",
  },
  "floodsense_seed.exposure_join": {
    publisher: "Copernicus EMS, OpenStreetMap, synthetic portfolio",
    licence: "Copernicus terms, ODbL",
    settled: true,
    sql:
      "SELECT policy_id, site_id, lat, lon, segment, sum_insured_eur\n" +
      "  FROM floodsense_seed.exposure_join\n" +
      " WHERE in_footprint = 1\n" +
      " ORDER BY sum_insured_eur DESC",
  },
};

window.JUDGE = {
  overall: "1.00",
  claims: 10,
  rows: [
    ["Hallucination rate", "0%"],
    ["Citation coverage", "100%"],
    ["Numeric accuracy", "100%"],
    ["Repair rounds", "0"],
  ],
};

// Two voices for the same four actions: a short imperative for the analyst,
// plain instructions for everyone else.
window.PLAYBOOK = [
  {
    id: "A1",
    horizon: 6,
    when: "Next 6 hours",
    outbound: true,
    head: "Message policyholders at the exposed sites",
    plain:
      "Tell people at the sites to move stock and vehicles above ground level, " +
      "photograph any damage, and stay out of flooded basements.",
    full:
      "Send a safety and claims-readiness message to policyholders at the exposed sites, " +
      "largest sum insured first: move stock and vehicles above ground level, document damage, " +
      "do not enter flooded basements.",
    claims: ["C9", "C10"],
  },
  {
    id: "A2",
    horizon: 6,
    when: "Next 6 hours",
    outbound: false,
    head: "Open the event file and reserve capacity",
    plain: "Open a claim file covering the seven sites and set money aside for them.",
    full:
      "Open an event file with the exposed policy list and reserve capacity for the " +
      "sum insured at risk.",
    claims: ["C9", "C10", "C1", "C2", "C3"],
  },
  {
    id: "A3",
    horizon: 24,
    when: "Tomorrow",
    outbound: true,
    head: "Pre-assign loss adjusters to the footprint",
    plain: "Line up loss adjusters now so they can visit as soon as the authorities allow it.",
    full:
      "Pre-assign loss adjusters to the footprint municipalities and book site access " +
      "once the authority lifts the alert.",
    claims: ["C9", "C10"],
  },
  {
    id: "A4",
    horizon: 72,
    when: "This week",
    outbound: false,
    head: "Re-run the join when the map updates",
    plain: "Check the figures again once the flood map is updated and the river gauge is back.",
    full:
      "Re-run the exposure join when the Copernicus footprint is updated and the gauges " +
      "report again, then revise reserves.",
    claims: ["C1", "C2", "C3"],
  },
];

window.fmt = new Intl.NumberFormat("en-GB");
window.esc = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
window.svgEl = (name, attrs, text) => {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const k in attrs) node.setAttribute(k, attrs[k]);
  if (text != null) node.textContent = text;
  return node;
};
