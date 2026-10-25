// DesignLabIQC-ClinChem — calculation core.
// Pure functions only (no React, no DOM): statistics, the preloaded panel,
// derived values, rule search, CUSUM/EWMA/multirule models. Imported by the
// component and by the test suite (tool/test/).

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

// Incomplete gamma, used to get a high-accuracy erf/erfc so that tail
// probabilities at k = 4+ stay meaningful.
export const LN_GAMMA_HALF = 0.5723649429247001;

export function gserHalf(x) {
  // Series expansion of P(1/2, x)
  let ap = 0.5;
  let sum = 2.0; // 1/a with a = 0.5
  let del = sum;
  for (let n = 0; n < 200; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
  }
  return sum * Math.exp(-x + 0.5 * Math.log(x) - LN_GAMMA_HALF);
}

export function gcfHalf(x) {
  // Continued fraction for Q(1/2, x)
  const a = 0.5;
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 300; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h * Math.exp(-x + a * Math.log(x) - LN_GAMMA_HALF);
}

export function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  const xx = x * x;
  return xx < 1.5 ? 1 - gserHalf(xx) : gcfHalf(xx);
}

export const SQRT2 = Math.SQRT2;

// Upper tail P(Z > z)
export function normSf(z) {
  return 0.5 * erfc(z / SQRT2);
}

export function normCdf(z) {
  return z >= 0 ? 1 - normSf(z) : normSf(-z);
}

// Probability a single control result falls inside +/- k when the process
// has shifted by `shift` standard deviations.
export function insideProb(k, shift) {
  return normCdf(k - shift) - normCdf(-k - shift);
}

export function falseRejection(k, n) {
  return 1 - Math.pow(insideProb(k, 0), n);
}

export function errorDetection(k, n, shift) {
  if (!isFinite(shift) || shift <= 0) return 0;
  return 1 - Math.pow(insideProb(k, shift), n);
}

export function combine(values) {
  return 1 - values.reduce((acc, p) => acc * (1 - p), 1);
}

// Smallest shift a rule detects with the wanted probability. Ped rises
// monotonically with shift, so bisection is safe.
export function shiftForDetection(k, n, targetPed) {
  let lo = 0;
  let hi = 30;
  if (errorDetection(k, n, hi) < targetPed) return Infinity;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (errorDetection(k, n, mid) < targetPed) lo = mid;
    else hi = mid;
  }
  return hi;
}

// Sigma bands and the QC plan each one calls for (Cooper et al., 2011).
/* Allowable total error from biological variation (Fraser), three tiers.
   TEa = 1.65 * kI * CVI + kB * sqrt(CVI^2 + CVG^2)                               */
export const BV_TIERS = [
  { key: "optimal", label: "BV optimal", kI: 0.25, kB: 0.125 },
  { key: "desirable", label: "BV desirable", kI: 0.5, kB: 0.25 },
  { key: "minimum", label: "BV minimum", kI: 0.75, kB: 0.375 },
];

export function bvTea(cvi, cvg, tier) {
  const i = Number(cvi), g = Number(cvg);
  if (!(i > 0) || !(g >= 0)) return NaN;
  return 1.65 * tier.kI * i + tier.kB * Math.sqrt(i * i + g * g);
}

/** Options actually offered for an analyte: its listed sources plus the
    three BV tiers whenever CVI and CVG have been entered.                    */
export function teaOptionsFor(analyte) {
  const base = analyte.teaOptions || [];
  const bv = analyte.bv || {};
  const tiers = BV_TIERS.map((t) => ({
    label: t.label,
    value: bvTea(bv.cvi, bv.cvg, t),
    computed: true,
  })).filter((o) => isFinite(o.value));
  // Drop listed sources that a computed tier now supersedes by label.
  const names = new Set(tiers.map((t) => t.label));
  return [...base.filter((o) => !names.has(o.label)), ...tiers];
}

export function sigmaBand(sigma) {
  if (!isFinite(sigma)) return null;
  if (sigma >= 6)
    return {
      label: "World class",
      tone: "emerald",
      plan: "One control level a day, alternating levels, single 3 SD rule.",
    };
  if (sigma >= 4)
    return {
      label: "Fit for purpose",
      tone: "teal",
      plan: "Two control levels a day, 2.5 SD rule.",
    };
  if (sigma >= 3)
    return {
      label: "Marginal",
      tone: "amber",
      plan: "Two levels twice a day, combined rules.",
    };
  return {
    label: "Unacceptable",
    tone: "rose",
    plan: "Three levels three times a day, run controls in duplicate, and fix the method.",
  };
}

export const TONE = {
  emerald: "bg-emerald-50 text-emerald-800",
  teal: "bg-teal-50 text-teal-800",
  amber: "bg-amber-50 text-amber-900",
  rose: "bg-rose-50 text-rose-800",
};

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

export const uid = () => Math.random().toString(36).slice(2, 9);

export function lvl(label, target, cv, n, k, mfrRange = 0) {
  return { id: uid(), label, target, cv, n, k, bias: 0, locked: false, mfrRange };
}

export const PANELS = ["Clinical chemistry", "Immunochemistry"];

/* Starting panel: Roche cobas pro (two c 703 units, ISE module, two e 801 units),
   Sero control material at two levels. Targets are the LIS targets in force on
   16 October 2026. CV and allowable total error are deliberately left empty:
   CV comes from "Import results" (pooled within-lot CV of the worst analyser
   over the study period), the allowable error and its source are entered per
   analyte. CV (worst analyser, pooled within lot),
   target (mean of the control lot in use at the end of the period) and analyser offset
   are pre-filled from 1 May 2025 – 30 June 2026. */
export function ccAnalyte(panel, name, unit, pedReq, l1, l2, note = "") {
  return {
    id: uid(),
    panel,
    name,
    pedReq,
    unit,
    tea: "",
    teaSource: "Custom",
    teaOptions: [],
    bv: {},
    levels: [
      lvl("L1", l1[0], l1[1] ?? "", 1, 3),
      lvl("L2", l2[0], l2[1] ?? "", 1, 3),
    ],
    note,
  };
}

export const DEFAULT_ANALYTES = [
  {
    id: uid(),
    panel: "Clinical chemistry",
    name: "Sodium",
    pedReq: 90,
    unit: "mmol/L",
    tea: 5,
    teaSource: "SEKK Dmax",
    teaOptions: [
      { label: "Labquality", value: 2 },
      { label: "Rili-BÄK", value: 3 },
      { label: "RCPA", value: 2 },
      { label: "China WS/T 403-2024", value: 4 },
      { label: "SEKK Dmax", value: 5 },
      { label: "Belgium WIV-ISP", value: 3.4 },
      { label: "Turkey MoH 2026", value: 9 },
      { label: "BV Ricos (desirable)", value: 0.73 },
    ],
    bv: { cvi: 0.5, cvg: 0.7 },
    levels: [
      Object.assign(lvl("L1", 136.569, 1.088, 1, 3.1), { bias: 0.236, lisTarget: 136.5, lisSd: 1.365 }),
      Object.assign(lvl("L2", 154.677, 0.726, 1, 2.5), { bias: 0.251, lisTarget: 153.5, lisSd: 1.535 }),
    ],
    note: "ISE module, four units. CV includes accepted results whose QC status was Error (sensitivity CV without them: L1 0.67%).",
  },
  {
    id: uid(),
    panel: "Clinical chemistry",
    name: "Creatinine",
    pedReq: 90,
    unit: "\u00b5mol/L",
    tea: 8,
    teaSource: "Labquality",
    teaOptions: [
      { label: "Labquality", value: 8 },
      { label: "CLIA", value: 10 },
      { label: "Rili-BÄK", value: 11.5 },
      { label: "RCPA", value: 8 },
      { label: "China WS/T 403-2024", value: 12 },
      { label: "SEKK Dmax", value: 15 },
      { label: "Belgium WIV-ISP", value: 10.9 },
      { label: "Turkey MoH 2026", value: 20 },
      { label: "BV Ricos (desirable)", value: 8.87 },
    ],
    bv: { cvi: 4.4, cvg: 16.1 },
    levels: [
      Object.assign(lvl("L1", 99.1432, 1.903, 1, 3.1), { bias: 0.116, lisTarget: 99.2, lisSd: 2.94 }),
      Object.assign(lvl("L2", 356.985, 1.288, 1, 2.5), { bias: 0.073, lisTarget: 361, lisSd: 5.4 }),
    ],
    note: "Two c 703 units. One control lot over the period; LIS targets 99.2 and 361.",
  },
  {
    id: uid(),
    panel: "Clinical chemistry",
    name: "ALT",
    pedReq: 70,
    unit: "U/L",
    tea: 12,
    teaSource: "Labquality",
    teaOptions: [
      { label: "Labquality", value: 12 },
      { label: "CLIA", value: 15 },
      { label: "Rili-BÄK", value: 11.5 },
      { label: "RCPA", value: 12 },
      { label: "China WS/T 403-2024", value: 15 },
      { label: "SEKK Dmax", value: 15 },
      { label: "Belgium WIV-ISP", value: 13.3 },
      { label: "Turkey MoH 2026", value: 20 },
      { label: "BV Ricos (desirable)", value: 27.48 },
    ],
    bv: { cvi: 12.4, cvg: 29.8 },
    levels: [
      Object.assign(lvl("L1", 53.6702, 2.446, 1, 2.8), { bias: 0.935, lisTarget: 55, lisSd: 2.2 }),
      Object.assign(lvl("L2", 166.062, 2.171, 1, 2.6), { bias: 1.059, lisTarget: 167, lisSd: 3.34 }),
    ],
    note: "Three c 703 units. Recalibration step of about +7% on 20\u201324 May 2025; targets re-set within the lot.",
  },
  {
    id: uid(),
    panel: "Clinical chemistry",
    name: "Glucose",
    pedReq: 90,
    unit: "mmol/L",
    tea: 9.61379,
    teaSource: "BV minimum",
    teaOptions: [
      { label: "Labquality", value: 6 },
      { label: "CLIA", value: 8 },
      { label: "Rili-BÄK", value: 5 },
      { label: "RCPA", value: 8 },
      { label: "China WS/T 403-2024", value: 7 },
      { label: "SEKK Dmax", value: 9 },
      { label: "Belgium WIV-ISP", value: 6.3 },
      { label: "Turkey MoH 2026", value: 10 },
      { label: "BV Ricos (desirable)", value: 6.96 },
    ],
    bv: { cvi: 4.9, cvg: 8.1 },
    levels: [
      Object.assign(lvl("L1", 5.30429, 1.932, 1, 2.8), { bias: 0.478, lisTarget: 5.3, lisSd: 0.159 }),
      Object.assign(lvl("L2", 14.679, 1.495, 1, 2.6), { bias: 0.322, lisTarget: 14.5, lisSd: 0.435 }),
    ],
    note: "Two c 703 units.",
  },
  {
    id: uid(),
    panel: "Clinical chemistry",
    name: "Calcium",
    pedReq: 90,
    unit: "mmol/L",
    tea: 10,
    teaSource: "SEKK Dmax",
    teaOptions: [
      { label: "Labquality", value: 3 },
      { label: "Rili-BÄK", value: 6 },
      { label: "RCPA", value: 4 },
      { label: "China WS/T 403-2024", value: 5 },
      { label: "SEKK Dmax", value: 10 },
      { label: "Belgium WIV-ISP", value: 5 },
      { label: "Turkey MoH 2026", value: 10 },
      { label: "BV Ricos (desirable)", value: 2.55 },
    ],
    bv: { cvi: 1.8, cvg: 2.7 },
    levels: [
      Object.assign(lvl("L1", 2.24434, 1.190, 1, 3.3), { bias: 0.670, lisTarget: 2.24, lisSd: 0.034 }),
      Object.assign(lvl("L2", 3.13051, 0.998, 1, 3.2), { bias: 0.476, lisTarget: 3.135, lisSd: 0.031 }),
    ],
    note: "Two c 703 units. Defined L2 SD (0.99%) equals the observed CV.",
  },
  {
    id: uid(),
    panel: "Immunochemistry",
    name: "TSH",
    pedReq: 70,
    unit: "mIU/L",
    tea: 12.4205,
    teaSource: "BV optimal",
    teaOptions: [
      { label: "CLIA", value: 20 },
      { label: "Rili-BÄK", value: 13.5 },
      { label: "RCPA", value: 20 },
      { label: "China WS/T 403-2024", value: 20 },
      { label: "SEKK Dmax", value: 14 },
      { label: "Turkey MoH 2026", value: 25 },
      { label: "BV Ricos (desirable)", value: 23.7 },
    ],
    bv: { cvi: 17.9, cvg: 36.1 },
    levels: [
      Object.assign(lvl("L1", 3.02944, 2.462, 1, 2.8), { bias: 0.894, lisTarget: 3.06, lisSd: 0.113 }),
      Object.assign(lvl("L2", 10.4928, 2.287, 1, 2.6), { bias: 0.874, lisTarget: 10.6, lisSd: 0.336 }),
    ],
    note: "Three e 801 units. Control lot changed 24 Feb 2026.",
  },
  {
    id: uid(),
    panel: "Immunochemistry",
    name: "hs-Troponin T",
    pedReq: 90,
    unit: "ng/L",
    tea: 20,
    teaSource: "Rili-BÄK",
    teaOptions: [
      { label: "CLIA", value: 30 },
      { label: "Rili-BÄK", value: 20 },
      { label: "Noklus", value: 15 },
      { label: "RCPA", value: 20 },
    ],
    bv: { cvi: 11.4, cvg: 30.9 },
    levels: [
      Object.assign(lvl("L1", 18.7954, 3.013, 1, 2.6), { bias: 0.821, lisTarget: 19.4, lisSd: 0.873 }),
      Object.assign(lvl("L2", 2134.1, 4.509, 1, 2.8), { bias: 0.402, lisTarget: 2190, lisSd: 98.55 }),
    ],
    note: "Two e 801 units. L1 near the 99th-percentile limit (CV \u2264 10% required). Old L2 lot drifted upwards through 2025; new lot from 24 Feb 2026.",
  },
  {
    id: uid(),
    panel: "Immunochemistry",
    name: "Ferritin",
    pedReq: 70,
    unit: "\u00b5g/L",
    tea: 13.5,
    teaSource: "Rili-BÄK",
    teaOptions: [
      { label: "Labquality", value: 12 },
      { label: "CLIA", value: 20 },
      { label: "Rili-BÄK", value: 13.5 },
      { label: "RCPA", value: 15 },
      { label: "China WS/T 403-2024", value: 25 },
      { label: "SEKK Dmax", value: 24 },
      { label: "Turkey MoH 2026", value: 25 },
      { label: "BV Ricos (desirable)", value: 16.9 },
    ],
    bv: {},
    levels: [
      Object.assign(lvl("L1", 93.418, 2.571, 1, 2.6), { bias: 0.499, lisTarget: 95.8, lisSd: 3.832 }),
      Object.assign(lvl("L2", 586.639, 2.878, 1, 2.8), { bias: 0.144, lisTarget: 597, lisSd: 17.91 }),
    ],
    note: "Three e 801 units. Four L2 targets over the period; new lot reads below its target.",
  },
  {
    id: uid(),
    panel: "Immunochemistry",
    name: "PSA",
    pedReq: 70,
    unit: "\u00b5g/L",
    tea: 24.3701,
    teaSource: "BV minimum",
    teaOptions: [
      { label: "CLIA", value: 20 },
      { label: "Rili-BÄK", value: 15.5 },
      { label: "RCPA", value: 8 },
      { label: "China WS/T 403-2024", value: 25 },
      { label: "SEKK Dmax", value: 15 },
      { label: "Turkey MoH 2026", value: 25 },
      { label: "BV Ricos (desirable)", value: 33.6 },
    ],
    bv: { cvi: 6.8, cvg: 42 },
    levels: [
      Object.assign(lvl("L1", 4.04595, 4.088, 1, 2.8), { bias: 2.859, lisTarget: 4.11, lisSd: 0.226 }),
      Object.assign(lvl("L2", 20.8947, 3.992, 1, 2.6), { bias: 2.653, lisTarget: 21.2, lisSd: 1.024 }),
    ],
    note: "Two e 801 units. e801-1.1 drifts down between calibrations (\u224810% apart from e801-2.1 before the 21 May 2026 recalibration).",
  },
  {
    id: uid(),
    panel: "Immunochemistry",
    name: "25-OH vitamin D",
    pedReq: 70,
    unit: "nmol/L",
    tea: 30,
    teaSource: "RfB",
    teaOptions: [
      { label: "Rili-BÄK", value: 25 },
      { label: "RCPA", value: 15 },
      { label: "Turkey MoH 2026", value: 25 },
      { label: "RfB", value: 30 },
    ],
    bv: { cvi: 6.8, cvg: 37.6 },
    levels: [
      Object.assign(lvl("L1", 97.6875, 6.697, 1, 2.8), { bias: 1.798, lisTarget: 95.1, lisSd: 8.469 }),
      Object.assign(lvl("L2", 170.797, 5.749, 1, 2.6), { bias: 0.797, lisTarget: 168, lisSd: 11.138 }),
    ],
    note: "Three e 801 units. Reagent-lot change in June 2025 raised results by \u224810%.",
  },
];

/* cobas infinity test codes of the study laboratory, mapped to the names used
   in the panel so that a raw export updates the matching card. Any other code
   is kept as it is and added as a new card. */
export const TEST_CODES = {
  "S-Na": "Sodium",
  "S-Kalium": "Potassium",
  "S-Klorid": "Chloride",
  "S-Kreat": "Creatinine",
  "S-Urea": "Urea",
  "S-Urat": "Urate",
  "S-ALAT": "ALT",
  "S-ASAT": "AST",
  "S-ALP": "ALP",
  "S-gGT": "GGT",
  "S-LD": "LD",
  "S-CK": "CK",
  "S-Amyl": "Amylase",
  "S-Lipase": "Lipase",
  "S-Bili": "Bilirubin",
  "S-Alb": "Albumin",
  "S-Prot": "Total protein",
  "S-Gluk": "Glucose",
  "S-Kals": "Calcium",
  "S-Fosfat": "Phosphate",
  "S-Mg": "Magnesium",
  "S-CRP": "CRP",
  "S-Kol": "Cholesterol",
  "S-HDL": "HDL cholesterol",
  "S-LDL": "LDL cholesterol",
  "S-Trig": "Triglycerides",
  "S-Jern": "Iron",
  "S-Trans": "Transferrin",
  "S-IgA": "IgA",
  "S-IgG": "IgG",
  "S-IgM": "IgM",
  "S-RF": "Rheumatoid factor",
  "S-Bikarb": "Bicarbonate",
  "P-Ammon": "Ammonia",
  "S-Etanol": "Ethanol",
  "P-HCY": "Homocysteine",
  "S-Litium": "Lithium",
  "S-Genta": "Gentamicin",
  "S-Vanc3": "Vancomycin",
  "S-Valp": "Valproate",
  "S-Karb": "Carbamazepine",
  "S-Parac": "Paracetamol",
  "S-TSH": "TSH",
  "S-FT4": "Free T4",
  "S-FT3": "Free T3",
  "S-hsTnT": "hs-Troponin T",
  "S-proBNP": "NT-proBNP",
  "S-PTH": "PTH",
  "S-Ferr": "Ferritin",
  "S-PSA": "PSA",
  "S-VitD": "25-OH vitamin D",
  "S-B12": "Vitamin B12 (total)",
  "S-AB12": "Active B12",
  "S-Folat": "Folate",
  "S-PCT": "Procalcitonin",
  "S-Kort": "Cortisol",
  "S-HCG-GR": "hCG",
  "S-C-pep": "C-peptide",
  "S-CEA": "CEA",
  "S-CA125": "CA 125",
  "S-A-TPO": "Anti-TPO",
  "S-A-CCP": "Anti-CCP",
  "S-Dig": "Digoxin"
};

/* Names offered when adding an allowable-error source. Any label may be typed. */
export const SOURCE_SUGGESTIONS = [
  "Labquality",
  "Noklus",
  "CLIA",
  "Rili-BÄK",
  "Turkey MoH 2026",
  "BV EFLM (optimal)",
  "BV EFLM (desirable)",
  "BV EFLM (minimum)",
  "BV Ricos (optimal)",
  "BV Ricos (desirable)",
  "BV Ricos (minimum)",
];

export const DEFAULT_SETTINGS = {
  pfrBudget: 1.5, // %
  pedTarget: 90, // %
  zAlpha: 1.65,
  qmMultiplier: 3,
  cusumK: 0.5,
  cusumH: 5,
  // How the critical systematic error is sized: "common" — one error, in per
  // cent, for the measurand (TEa − max over levels of |bias| + z·CV), turned
  // into SD at each level with that level's CV; "perlevel" — each level at
  // its own critical shift (sigma − z), the older convention.
  critMode: "common",
};

/* Critical systematic error of a measurand under the chosen convention.
   Returns the error in per cent (common) or NaN (per level). */
export function criticalErrorPct(levels, tea, settings) {
  if (settings.critMode !== "common" || !(tea > 0)) return NaN;
  let worst = -Infinity;
  for (const l of levels) {
    const cv = Number(l.cv); if (!(cv > 0)) return NaN;
    worst = Math.max(worst, Math.abs(Number(l.bias) || 0) + settings.zAlpha * cv);
  }
  return tea - worst;
}
/* Shift in SD at one level for the chosen convention. */
export function criticalShiftFor(level, tea, settings, critPct) {
  const cv = Number(level.cv); const bias = Math.abs(Number(level.bias) || 0);
  if (!(cv > 0)) return NaN;
  if (settings.critMode === "common") return isFinite(critPct) ? Math.max(0, (critPct - bias) / cv) : NaN;
  return (tea - bias) / cv - settings.zAlpha;
}

/* ------------------------------------------------------------------ */
/* Derived values                                                      */
/* ------------------------------------------------------------------ */

export function computeLevel(level, tea, settings, critPct = NaN) {
  const cv = Number(level.cv);
  const target = Number(level.target);
  const k = Number(level.k);
  const n = Math.max(1, Math.round(Number(level.n) || 1));
  const bias = Number(level.bias) || 0;

  const teaAsSd = cv > 0 ? tea / cv : NaN;
  // Sigma metric, the same quantity the literature reports: (TEa - bias) / CV.
  const sigma = cv > 0 ? (tea - Math.abs(bias)) / cv : NaN;
  const criticalShift = criticalShiftFor(level, tea, settings, critPct);
  const pfr = falseRejection(k, n);
  // The action limits are centred on the target. If the analyser's own mean sits
  // away from that target, the control distribution is off-centre and the rule
  // fires more often with nothing actually wrong. Offset in SD units = bias / CV.
  const offsetSd = cv > 0 ? Math.abs(bias) / cv : 0;
  const pfrOffset = offsetSd > 0 ? errorDetection(k, n, offsetSd) : pfr;
  const ped = criticalShift > 0 ? errorDetection(k, n, criticalShift) : 0;
  const actionLimit = cv > 0 ? target * (cv / 100) * k : NaN;
  const sdForLis = actionLimit / settings.qmMultiplier;
  const cvForLis = target > 0 ? (sdForLis / target) * 100 : NaN;
  const sd = target * (cv / 100);

  // The manufacturer states a range, not a rule. Expressed in the laboratory's
  // own imprecision it becomes one, and can then be compared like for like.
  const mfrRange = Number(level.mfrRange) || 0;
  const hasMfr = mfrRange > 0 && sd > 0;
  const mfrK = hasMfr ? mfrRange / sd : NaN;
  const mfrPfr = hasMfr ? falseRejection(mfrK, n) : NaN;
  const mfrPed =
    hasMfr && criticalShift > 0 ? errorDetection(mfrK, n, criticalShift) : hasMfr ? 0 : NaN;

  // The target and SD currently entered in the LIS, when known. The LIS rule is
  // taken as 1:3s on its own SD, which is how cobas infinity flags "Error".
  // Expressed in the laboratory's observed SD it becomes a K around a centre
  // that may sit away from the lot mean, and its false-alarm and detection
  // probabilities follow like any other rule.
  const lisTarget = Number(level.lisTarget);
  const lisSd = Number(level.lisSd);
  const hasLis = lisTarget > 0 && lisSd > 0 && sd > 0;
  const lisK = hasLis ? (settings.qmMultiplier * lisSd) / sd : NaN;
  const lisOffsetSd = hasLis ? (lisTarget - target) / sd : NaN;
  const lisPfr = hasLis ? errorDetection(lisK, n, Math.abs(lisOffsetSd)) || falseRejection(lisK, n) : NaN;
  const lisPed = hasLis && criticalShift > 0 ? errorDetection(lisK, n, criticalShift) : hasLis ? 0 : NaN;
  const lisSdChange = hasLis ? (sdForLis / lisSd - 1) * 100 : NaN;

  return {
    ...level,
    n,
    teaAsSd,
    sigma,
    criticalShift,
    pfr,
    hasLis,
    lisK,
    lisOffsetSd,
    lisPfr,
    lisPed,
    lisSdChange,
    offsetSd,
    pfrOffset,
    ped,
    actionLimit,
    sdForLis,
    cvForLis,
    mfrK,
    mfrPfr,
    mfrPed,
    hasMfr,
    lower: target - actionLimit,
    upper: target + actionLimit,
  };
}

/** If the chosen source is a computed BV tier, follow CVI/CVG live. */
export function effectiveTea(analyte) {
  const opt = teaOptionsFor(analyte).find(
    (o) => o.computed && o.label === analyte.teaSource
  );
  const t = Number(analyte.tea);
  return opt ? opt.value : analyte.tea === "" || analyte.tea == null || !(t > 0) ? NaN : t;
}

/** What still has to be entered before an analyte can be judged. */
export function missingInputs(analyte) {
  const miss = [];
  if (!(effectiveTea(analyte) > 0)) miss.push("allowable error");
  if (!analyte.levels.every((l) => Number(l.cv) > 0)) miss.push("CV");
  if (!analyte.levels.every((l) => Number(l.target) > 0)) miss.push("target");
  return miss;
}

export function computeAnalyte(analyte, settings) {
  const tea = effectiveTea(analyte);
  const critPct = criticalErrorPct(analyte.levels, tea, settings);
  const levels = analyte.levels.map((l) => computeLevel(l, tea, settings, critPct));
  const combinedPfr = combine(levels.map((l) => l.pfr));
  const combinedPfrOffset = combine(levels.map((l) => l.pfrOffset));
  const anyOffset = levels.some((l) => l.offsetSd > 0);
  const combinedPed = combine(levels.map((l) => l.ped));
  const lisLevels = levels.filter((l) => l.hasLis);
  const hasLis = lisLevels.length === levels.length && levels.length > 0;
  const mfrLevels = levels.filter((l) => l.hasMfr);
  const complete = mfrLevels.length === levels.length && levels.length > 0;
  const missing = missingInputs(analyte);
  return {
    ...analyte,
    levels,
    missing,
    ready: missing.length === 0,
    combinedPfr,
    combinedPfrOffset,
    anyOffset,
    combinedPed,
    combinedMfrPfr: complete ? combine(mfrLevels.map((l) => l.mfrPfr)) : NaN,
    combinedMfrPed: complete ? combine(mfrLevels.map((l) => l.mfrPed)) : NaN,
    hasMfr: complete,
    hasLis,
    critPct,
    anyLis: lisLevels.length > 0,
    combinedLisPfr: hasLis ? combine(lisLevels.map((l) => l.lisPfr)) : NaN,
    combinedLisPed: hasLis ? combine(lisLevels.map((l) => l.lisPed)) : NaN,
    pfrOk: combinedPfr * 100 <= settings.pfrBudget + 1e-9,
    pfrOffsetOk: combinedPfrOffset * 100 <= settings.pfrBudget + 1e-9,
    // An analyte's own detection requirement, where set, overrides the global target.
    pedOk: combinedPed * 100 >= (analyte.pedReq ?? settings.pedTarget) - 1e-9,
  };
}

/* ------------------------------------------------------------------ */
/* Rule search                                                         */
/* ------------------------------------------------------------------ */

export const K_GRID = [];
for (let v = 15; v <= 50; v++) K_GRID.push(v / 10);

export function searchRules(analyte, settings, strategy) {
  const tea = effectiveTea(analyte);
  const levels = analyte.levels;

  const critPct = criticalErrorPct(levels, tea, settings);
  const precomputed = levels.map((l) => {
    const cv = Number(l.cv);
    const n = Math.max(1, Math.round(Number(l.n) || 1));
    const shift = cv > 0 ? criticalShiftFor(l, tea, settings, critPct) : 0;
    const options = l.locked
      ? [Number(l.k)]
      : K_GRID;
    return {
      shift,
      rows: options.map((k) => ({
        k,
        pfr: falseRejection(k, n),
        ped: shift > 0 ? errorDetection(k, n, shift) : 0,
      })),
    };
  });

  const budget = settings.pfrBudget / 100;
  let best = null;

  const walk = (idx, picked, keepInside, pedTerm) => {
    if (idx === precomputed.length) {
      const combinedPfr = 1 - keepInside;
      if (combinedPfr > budget + 1e-12) return;
      const combinedPed = 1 - pedTerm;
      let score;
      if (strategy === "l1") score = picked[0].ped * 1000 + combinedPed;
      else if (strategy === "ends")
        score =
          (picked[0].ped + (picked[picked.length - 1]?.ped ?? 0)) * 1000 + combinedPed;
      else score = combinedPed * 1000 - combinedPfr;
      if (!best || score > best.score) {
        best = {
          score,
          ks: picked.map((p) => p.k),
          combinedPfr,
          combinedPed,
        };
      }
      return;
    }
    for (const row of precomputed[idx].rows) {
      const nextKeep = keepInside * (1 - row.pfr);
      // Budget only ever shrinks as levels are added, so drop this branch early.
      if (1 - nextKeep > budget + 1e-12) continue;
      walk(idx + 1, [...picked, row], nextKeep, pedTerm * (1 - row.ped));
    }
  };

  walk(0, [], 1, 1);
  return best;
}

/* ------------------------------------------------------------------ */
/* Maximum acceptable CV                                               */
/* ------------------------------------------------------------------ */
/* For one level, the largest CV at which the analyte still meets its
   combined detection requirement, holding the other levels at their
   measured CV. Two variants: with the rules as they stand ("fixed K"),
   and with K re-optimised across all levels ("best K"). Returns null
   when the analyte has no detection requirement, and Infinity when even
   an arbitrarily large CV still meets it (the requirement is not the
   binding constraint).                                                 */

export function combinedPedAtCv(analyte, settings, levelIndex, cv, useBestK) {
  const tea = effectiveTea(analyte);
  const z = settings.zAlpha;
  const trial = {
    ...analyte,
    levels: analyte.levels.map((l, i) =>
      i === levelIndex ? { ...l, cv } : { ...l }
    ),
  };
  if (useBestK) {
    const best = searchRules(trial, settings, "ends");
    return best ? best.combinedPed : 0;
  }
  // fixed K: combine each level's Ped at its current K
  let miss = 1;
  const critPct = criticalErrorPct(trial.levels, tea, settings);
  trial.levels.forEach((l) => {
    const c = Number(l.cv);
    const n = Math.max(1, Math.round(Number(l.n) || 1));
    const shift = c > 0 ? criticalShiftFor(l, tea, settings, critPct) : 0;
    const ped = shift > 0 ? errorDetection(Number(l.k), n, shift) : 0;
    miss *= 1 - ped;
  });
  return 1 - miss;
}

export function maxCvForLevel(analyte, settings, levelIndex, useBestK) {
  const floor = analyte.pedReq;
  if (!floor && floor !== 0) return null; // no requirement for this analyte
  const target = floor / 100;
  const pedAt = (cv) => combinedPedAtCv(analyte, settings, levelIndex, cv, useBestK);
  const hi = 60;
  if (pedAt(hi) >= target) return Infinity; // requirement never binds
  const cur = Number(analyte.levels[levelIndex].cv);
  const lo0 = Math.min(0.01, cur / 100);
  if (pedAt(lo0) < target) return 0; // cannot meet even at tiny CV
  let lo = lo0,
    hi2 = hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi2) / 2;
    if (pedAt(mid) >= target) lo = mid;
    else hi2 = mid;
  }
  return lo;
}

/* Informational CV targets for a fixed sigma, used when the analyte has
   no detection requirement: CV such that (TEa - bias)/CV = sigma.       */
export function cvForSigma(analyte, levelIndex, sigma) {
  const tea = effectiveTea(analyte);
  const l = analyte.levels[levelIndex];
  const num = tea - Math.abs(Number(l.bias) || 0);
  return num > 0 && sigma > 0 ? num / sigma : NaN;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* CUSUM                                                               */
/* ------------------------------------------------------------------ */
/* Tabular CUSUM (Page 1954) on standardised control results
   z = (x − centre) / SD. Two sums accumulate departures beyond a reference
   value k: C⁺ = max(0, C⁺ + z − k), C⁻ = max(0, C⁻ − z − k). An alarm is
   raised when either exceeds the decision limit h; both are then reset.
   k is set to half the shift the chart should catch quickly (k = 0.5 SD for
   a 1 SD shift). Average run lengths use Siegmund's approximation with
   b = h + 1.166 (Siegmund 1985), which is accurate to a few percent.    */

export function cusumArl(shift, k, h) {
  const d = shift - k;
  const b = h + 1.166;
  if (Math.abs(d) < 1e-9) return b * b;
  return (Math.exp(-2 * d * b) + 2 * d * b - 1) / (2 * d * d);
}

/* Two-sided ARL: in control the two one-sided charts run in parallel. */
export function cusumArl0(k, h) {
  return cusumArl(0, k, h) / 2;
}

/* ARL of a 1:K Shewhart rule with n controls per event at a shift (SD). */
export function shewhartArl(k, n, shift) {
  const p = shift > 0 ? errorDetection(k, n, shift) : falseRejection(k, n);
  return p > 0 ? 1 / p : Infinity;
}

/* Run the tabular CUSUM over one series of standardised values. Returns the
   path and the alarms (index, sign). */
export function runCusum(z, k, h) {
  let cp = 0, cn = 0;
  const path = [];
  const alarms = [];
  let run = 0;
  for (let i = 0; i < z.length; i++) {
    cp = Math.max(0, cp + z[i] - k);
    cn = Math.max(0, cn - z[i] - k);
    run++;
    let alarm = 0;
    if (cp > h) alarm = 1;
    else if (cn > h) alarm = -1;
    path.push({ i, cp, cn: -cn, z: z[i], alarm });
    if (alarm) {
      alarms.push({ i, sign: alarm, run });
      cp = 0; cn = 0; run = 0;
    }
  }
  return { path, alarms };
}




/* ------------------------------------------------------------------ */
/* Further laboratory-specific models from the same control data      */
/* ------------------------------------------------------------------ */

/* Seeded normal deviates (xorshift32 + Box–Muller) so that simulations
   repeat exactly between renders. */
export function makeRng(seed = 20261018) {
  let x = seed >>> 0 || 1;
  const u = () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return (x + 0.5) / 4294967296;
  };
  return () => {
    const a = u(), b = u();
    return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
  };
}

/* EWMA: e = λ z + (1 − λ) e, alarm when |e| > L·sqrt(λ/(2−λ)). */
export function ewmaLimit(lam, L) { return L * Math.sqrt(lam / (2 - lam)); }
export function ewmaArl(shift, lam, L, runs = 1200, cap = 6000) {
  const rnd = makeRng(7 + Math.round(shift * 100)); const lim = ewmaLimit(lam, L); let tot = 0;
  for (let r = 0; r < runs; r++) {
    let e = 0, i = 0;
    for (i = 1; i <= cap; i++) { e = lam * (rnd() + shift) + (1 - lam) * e; if (Math.abs(e) > lim) break; }
    tot += i;
  }
  return tot / runs;
}
export function runEwma(z, lam, L) {
  const lim = ewmaLimit(lam, L); let e = 0; const path = []; const alarms = []; let run = 0;
  for (let i = 0; i < z.length; i++) {
    e = lam * z[i] + (1 - lam) * e; run++;
    const alarm = Math.abs(e) > lim ? Math.sign(e) : 0;
    path.push({ i, e, z: z[i], alarm });
    if (alarm) { alarms.push({ i, sign: alarm, run }); e = 0; run = 0; }
  }
  return { path, alarms, lim };
}

/* Westgard multirule evaluation on the laboratory's own SD. Two or more
   levels per event; rules read across levels within an event and across
   consecutive events (2-2s, 4-1s, 10x). */
export function multiruleReject(rules, hist, nl) {
  const z = hist[hist.length - 1];
  if (rules.has("13s") && z.some((v) => Math.abs(v) > 3)) return true;
  if (rules.has("12s") && z.some((v) => Math.abs(v) > 2)) return true;
  if (rules.has("22s")) {
    if (z.every((v) => v > 2) || z.every((v) => v < -2)) return true;
    if (hist.length >= 2) {
      const p = hist[hist.length - 2];
      for (let i = 0; i < nl; i++) if ((z[i] > 2 && p[i] > 2) || (z[i] < -2 && p[i] < -2)) return true;
    }
  }
  if (rules.has("R4s") && nl >= 2 && Math.max(...z) > 2 && Math.min(...z) < -2) return true;
  if (rules.has("41s")) {
    const seq = hist.slice(-Math.max(1, Math.ceil(4 / nl))).flat().slice(-4);
    if (seq.length >= 4 && (seq.every((v) => v > 1) || seq.every((v) => v < -1))) return true;
    if (hist.length >= 4) for (let i = 0; i < nl; i++) {
      const col = hist.slice(-4).map((e) => e[i]);
      if (col.every((v) => v > 1) || col.every((v) => v < -1)) return true;
    }
  }
  if (rules.has("10x")) {
    const seq = hist.slice(-Math.max(1, Math.ceil(10 / nl))).flat().slice(-10);
    if (seq.length >= 10 && (seq.every((v) => v > 0) || seq.every((v) => v < 0))) return true;
  }
  return false;
}
export function multirulePfr(rules, nl, events = 8000) {
  const rnd = makeRng(11); let hist = []; let rej = 0, tot = 0;
  for (let ev = 0; ev < events + 12; ev++) {
    hist.push(Array.from({ length: nl }, () => rnd())); if (hist.length > 12) hist.shift();
    if (ev >= 12) { tot++; if (multiruleReject(rules, hist, nl)) rej++; }
  }
  return rej / tot;
}
export function multirulePed(rules, shifts, trials = 3000) {
  const rnd = makeRng(13); const nl = shifts.length; let first = 0, two = 0;
  for (let t = 0; t < trials; t++) {
    const hist = Array.from({ length: 12 }, () => Array.from({ length: nl }, () => rnd()));
    hist.push(shifts.map((s) => rnd() + s)); const r1 = multiruleReject(rules, hist.slice(-12), nl);
    hist.push(shifts.map((s) => rnd() + s)); const r2 = r1 || multiruleReject(rules, hist.slice(-12), nl);
    if (r1) first++; if (r2) two++;
  }
  return { first: first / trials, two: two / trials };
}

/* Binary segmentation: split where the standardised mean difference is largest. */
export function binseg(z, minseg = 15, thr = 4, depth = 0, offset = 0, out = []) {
  const n = z.length;
  if (n < 2 * minseg || depth > 5) return out;
  const cs = []; let acc = 0; for (const v of z) { acc += v; cs.push(acc); }
  const tot = acc; let best = null;
  for (let i = minseg; i <= n - minseg; i++) {
    const m1 = cs[i - 1] / i, m2 = (tot - cs[i - 1]) / (n - i);
    const stat = Math.abs(m1 - m2) * Math.sqrt((i * (n - i)) / n);
    if (!best || stat > best.stat) best = { stat, i, m1, m2 };
  }
  if (best && best.stat > thr) {
    out.push({ i: offset + best.i, step: best.m2 - best.m1, stat: best.stat });
    binseg(z.slice(0, best.i), minseg, thr, depth + 1, offset, out);
    binseg(z.slice(best.i), minseg, thr, depth + 1, offset + best.i, out);
  }
  return out;
}

export const RULE_SETS = [
  ["1-2s", ["12s"]], ["1-3s", ["13s"]], ["1-3s/2-2s/R-4s", ["13s", "22s", "R4s"]],
  ["1-3s/2-2s/R-4s/4-1s", ["13s", "22s", "R4s", "41s"]], ["1-3s/2-2s/R-4s/4-1s/10x", ["13s", "22s", "R4s", "41s", "10x"]],
];

