import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ReferenceDot,
  ResponsiveContainer,
} from "recharts";

/* Local persistence: the standalone build saves to the browser's localStorage. */
if (typeof window !== "undefined" && !window.storage) {
  window.storage = {
    async get(k) { const v = localStorage.getItem(k); return v == null ? null : { key: k, value: v }; },
    async set(k, v) { localStorage.setItem(k, v); return { key: k, value: v }; },
    async delete(k) { localStorage.removeItem(k); return { key: k, deleted: true }; },
    async list(p) { const keys = []; for (let i = 0; i < localStorage.length; i++) { const kk = localStorage.key(i); if (!p || kk.startsWith(p)) keys.push(kk); } return { keys }; },
  };
}

import * as XLSX from "xlsx";

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

// Incomplete gamma, used to get a high-accuracy erf/erfc so that tail
// probabilities at k = 4+ stay meaningful.
const LN_GAMMA_HALF = 0.5723649429247001;

function gserHalf(x) {
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

function gcfHalf(x) {
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

function erfc(x) {
  if (x < 0) return 2 - erfc(-x);
  const xx = x * x;
  return xx < 1.5 ? 1 - gserHalf(xx) : gcfHalf(xx);
}

const SQRT2 = Math.SQRT2;

// Upper tail P(Z > z)
function normSf(z) {
  return 0.5 * erfc(z / SQRT2);
}

function normCdf(z) {
  return z >= 0 ? 1 - normSf(z) : normSf(-z);
}

// Probability a single control result falls inside +/- k when the process
// has shifted by `shift` standard deviations.
function insideProb(k, shift) {
  return normCdf(k - shift) - normCdf(-k - shift);
}

function falseRejection(k, n) {
  return 1 - Math.pow(insideProb(k, 0), n);
}

function errorDetection(k, n, shift) {
  if (!isFinite(shift) || shift <= 0) return 0;
  return 1 - Math.pow(insideProb(k, shift), n);
}

function combine(values) {
  return 1 - values.reduce((acc, p) => acc * (1 - p), 1);
}

// Smallest shift a rule detects with the wanted probability. Ped rises
// monotonically with shift, so bisection is safe.
function shiftForDetection(k, n, targetPed) {
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
const BV_TIERS = [
  { key: "optimal", label: "BV optimal", kI: 0.25, kB: 0.125 },
  { key: "desirable", label: "BV desirable", kI: 0.5, kB: 0.25 },
  { key: "minimum", label: "BV minimum", kI: 0.75, kB: 0.375 },
];

function bvTea(cvi, cvg, tier) {
  const i = Number(cvi), g = Number(cvg);
  if (!(i > 0) || !(g >= 0)) return NaN;
  return 1.65 * tier.kI * i + tier.kB * Math.sqrt(i * i + g * g);
}

/** Options actually offered for an analyte: its listed sources plus the
    three BV tiers whenever CVI and CVG have been entered.                    */
function teaOptionsFor(analyte) {
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

function sigmaBand(sigma) {
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

const TONE = {
  emerald: "bg-emerald-50 text-emerald-800",
  teal: "bg-teal-50 text-teal-800",
  amber: "bg-amber-50 text-amber-900",
  rose: "bg-rose-50 text-rose-800",
};

/* ------------------------------------------------------------------ */
/* Model                                                               */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 9);

function lvl(label, target, cv, n, k, mfrRange = 0) {
  return { id: uid(), label, target, cv, n, k, bias: 0, locked: false, mfrRange };
}

const PANELS = ["Clinical chemistry", "Immunochemistry"];

/* Starting panel: Roche cobas pro (two c 703 units, ISE module, two e 801 units),
   Sero control material at two levels. Targets are the LIS targets in force on
   16 October 2026. CV and allowable total error are deliberately left empty:
   CV comes from "Import results" (pooled within-lot CV of the worst analyser
   over the study period), the allowable error and its source are entered per
   analyte. Creatinine is pre-filled from 1 May 2025 – 30 June 2026
   (2 630 accepted results). */
function ccAnalyte(panel, name, unit, pedReq, l1, l2, note = "") {
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

const DEFAULT_ANALYTES = [
  ccAnalyte("Clinical chemistry", "Sodium", "mmol/L", 90, [136.5], [153.5],
    "Measured on the ISE module, not the c 703 photometric units. Narrow within-subject biological variation; the biological-variation tiers may fall below the analyser CV."),
  (() => {
    const a = ccAnalyte("Clinical chemistry", "Creatinine", "µmol/L", 90, [99.1476, 1.915], [356.99, 1.289],
      "Imported from 1 May 2025 – 30 June 2026, accepted results only, one control lot per level. LIS targets 99.2 and 361; the L2 analyser means sit about 1% below the LIS target.");
    a.levels[0].bias = 0.111;
    a.levels[1].bias = 0.071;
    return a;
  })(),
  ccAnalyte("Clinical chemistry", "ALT", "U/L", 70, [55], [167]),
  ccAnalyte("Clinical chemistry", "Glucose", "mmol/L", 90, [5.3], [14.5]),
  ccAnalyte("Clinical chemistry", "Calcium", "mmol/L", 90, [2.24], [3.135]),
  ccAnalyte("Immunochemistry", "TSH", "mIU/L", 70, [3.06], [10.6]),
  ccAnalyte("Immunochemistry", "hs-Troponin T", "ng/L", 90, [19.4], [2190],
    "L1 sits near the 99th-percentile decision limit, where a CV of 10% or less is required."),
  ccAnalyte("Immunochemistry", "Ferritin", "µg/L", 70, [95.8], [597]),
  ccAnalyte("Immunochemistry", "PSA", "µg/L", 70, [4.11], [21.2]),
  ccAnalyte("Immunochemistry", "25-OH vitamin D", "nmol/L", 70, [95.1], [168]),
];

/* Names offered when adding an allowable-error source. Any label may be typed. */
const SOURCE_SUGGESTIONS = [
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

const DEFAULT_SETTINGS = {
  pfrBudget: 1.5, // %
  pedTarget: 90, // %
  zAlpha: 1.65,
  qmMultiplier: 3,
};

/* ------------------------------------------------------------------ */
/* Derived values                                                      */
/* ------------------------------------------------------------------ */

function computeLevel(level, tea, settings) {
  const cv = Number(level.cv);
  const target = Number(level.target);
  const k = Number(level.k);
  const n = Math.max(1, Math.round(Number(level.n) || 1));
  const bias = Number(level.bias) || 0;

  const teaAsSd = cv > 0 ? tea / cv : NaN;
  // Sigma metric, the same quantity the literature reports: (TEa - bias) / CV.
  const sigma = cv > 0 ? (tea - Math.abs(bias)) / cv : NaN;
  const criticalShift = sigma - settings.zAlpha;
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

  // The manufacturer states a range, not a rule. Expressed in the laboratory's
  // own imprecision it becomes one, and can then be compared like for like.
  const sd = target * (cv / 100);
  const mfrRange = Number(level.mfrRange) || 0;
  const hasMfr = mfrRange > 0 && sd > 0;
  const mfrK = hasMfr ? mfrRange / sd : NaN;
  const mfrPfr = hasMfr ? falseRejection(mfrK, n) : NaN;
  const mfrPed =
    hasMfr && criticalShift > 0 ? errorDetection(mfrK, n, criticalShift) : hasMfr ? 0 : NaN;

  return {
    ...level,
    n,
    teaAsSd,
    sigma,
    criticalShift,
    pfr,
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
function effectiveTea(analyte) {
  const opt = teaOptionsFor(analyte).find(
    (o) => o.computed && o.label === analyte.teaSource
  );
  const t = Number(analyte.tea);
  return opt ? opt.value : analyte.tea === "" || analyte.tea == null || !(t > 0) ? NaN : t;
}

/** What still has to be entered before an analyte can be judged. */
function missingInputs(analyte) {
  const miss = [];
  if (!(effectiveTea(analyte) > 0)) miss.push("allowable error");
  if (!analyte.levels.every((l) => Number(l.cv) > 0)) miss.push("CV");
  if (!analyte.levels.every((l) => Number(l.target) > 0)) miss.push("target");
  return miss;
}

function computeAnalyte(analyte, settings) {
  const tea = effectiveTea(analyte);
  const levels = analyte.levels.map((l) => computeLevel(l, tea, settings));
  const combinedPfr = combine(levels.map((l) => l.pfr));
  const combinedPfrOffset = combine(levels.map((l) => l.pfrOffset));
  const anyOffset = levels.some((l) => l.offsetSd > 0);
  const combinedPed = combine(levels.map((l) => l.ped));
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
    pfrOk: combinedPfr * 100 <= settings.pfrBudget + 1e-9,
    pfrOffsetOk: combinedPfrOffset * 100 <= settings.pfrBudget + 1e-9,
    pedOk: combinedPed * 100 >= settings.pedTarget - 1e-9,
  };
}

/* ------------------------------------------------------------------ */
/* Rule search                                                         */
/* ------------------------------------------------------------------ */

const K_GRID = [];
for (let v = 15; v <= 50; v++) K_GRID.push(v / 10);

function searchRules(analyte, settings, strategy) {
  const tea = effectiveTea(analyte);
  const levels = analyte.levels;

  const precomputed = levels.map((l) => {
    const cv = Number(l.cv);
    const n = Math.max(1, Math.round(Number(l.n) || 1));
    const shift =
      (cv > 0 ? (tea - Math.abs(Number(l.bias) || 0)) / cv : 0) - settings.zAlpha;
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

function combinedPedAtCv(analyte, settings, levelIndex, cv, useBestK) {
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
  trial.levels.forEach((l) => {
    const c = Number(l.cv);
    const n = Math.max(1, Math.round(Number(l.n) || 1));
    const shift = (c > 0 ? (tea - Math.abs(Number(l.bias) || 0)) / c : 0) - z;
    const ped = shift > 0 ? errorDetection(Number(l.k), n, shift) : 0;
    miss *= 1 - ped;
  });
  return 1 - miss;
}

function maxCvForLevel(analyte, settings, levelIndex, useBestK) {
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
function cvForSigma(analyte, levelIndex, sigma) {
  const tea = effectiveTea(analyte);
  const l = analyte.levels[levelIndex];
  const num = tea - Math.abs(Number(l.bias) || 0);
  return num > 0 && sigma > 0 ? num / sigma : NaN;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const fmt = (v, d = 2) =>
  !isFinite(v) ? "—" : v.toFixed(d);
const pct = (v, d = 2) => (!isFinite(v) ? "—" : (v * 100).toFixed(d) + "%");

function sigDigits(value) {
  const abs = Math.abs(value);
  if (abs === 0) return 3;
  if (abs < 0.1) return 4;
  if (abs < 10) return 3;
  return 2;
}

/* ------------------------------------------------------------------ */
/* Small pieces                                                        */
/* ------------------------------------------------------------------ */

function NumberCell({ value, onChange, step = "any", width = "w-20", min }) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={`${width} rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-sm text-slate-900 focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600`}
    />
  );
}

function Verdict({ ok, children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 font-mono text-xs ${
        ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-emerald-600" : "bg-rose-600"}`}
      />
      {children}
    </span>
  );
}

/* The one loud element: how each level spends the false-alarm allowance. */
function BudgetMeter({ levels, combinedPfr, budget }) {
  const scale = Math.max(combinedPfr * 100, budget) * 1.15;
  const segments = levels.map((l) => ({
    label: l.label,
    width: ((l.pfr * 100) / scale) * 100,
  }));
  const markerLeft = (budget / scale) * 100;
  const over = combinedPfr * 100 > budget;

  return (
    <div className="w-full">
      <div className="relative h-6 w-full overflow-hidden rounded-sm bg-slate-100">
        <div className="flex h-full">
          {segments.map((s, i) => (
            <div
              key={s.label}
              style={{ width: `${s.width}%` }}
              title={`${s.label}: ${fmt((s.width / 100) * scale, 2)}%`}
              className={`h-full border-r border-white ${
                over
                  ? ["bg-rose-300", "bg-rose-400", "bg-rose-500", "bg-rose-600"][i % 4]
                  : ["bg-teal-300", "bg-teal-500", "bg-teal-700", "bg-teal-800"][i % 4]
              }`}
            />
          ))}
        </div>
        <div
          className="absolute top-0 h-full border-l-2 border-slate-900"
          style={{ left: `${markerLeft}%` }}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between font-mono text-xs text-slate-600">
        <span>
          {levels.map((l) => `${l.label} ${fmt(l.pfr * 100, 2)}`).join("  ·  ")}
        </span>
        <span className={over ? "text-rose-700" : "text-slate-700"}>
          {fmt(combinedPfr * 100, 2)}% of {fmt(budget, 1)}% allowance
        </span>
      </div>
    </div>
  );
}

function PowerCurves({ analyte, settings }) {
  const data = useMemo(() => {
    const points = [];
    for (let s = 0; s <= 6.01; s += 0.15) {
      const row = { shift: Number(s.toFixed(2)) };
      analyte.levels.forEach((l) => {
        row[l.label] = errorDetection(Number(l.k), l.n, s);
      });
      points.push(row);
    }
    return points;
  }, [analyte, settings]);

  const colors = ["#0f766e", "#0891b2", "#7c3aed", "#b45309"];

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <p className="mb-3 max-w-2xl text-sm text-slate-600">
        Detection probability against the size of a systematic shift. The vertical
        marks show each level's critical shift — where the curve sits at that mark is
        the Ped in the table.
      </p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 16, bottom: 24, left: 4 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 3" />
            <XAxis
              dataKey="shift"
              tick={{ fontSize: 11, fill: "#475569" }}
              stroke="#94a3b8"
              label={{
                value: "Systematic shift (SD)",
                position: "insideBottom",
                offset: -12,
                fontSize: 11,
                fill: "#475569",
              }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fontSize: 11, fill: "#475569" }}
              stroke="#94a3b8"
              tickFormatter={(v) => v.toFixed(1)}
            />
            <Tooltip
              formatter={(v) => v.toFixed(3)}
              labelFormatter={(v) => `Shift ${v} SD`}
              contentStyle={{ fontSize: 12, borderRadius: 4 }}
            />
            <Legend verticalAlign="top" align="right" height={22} wrapperStyle={{ fontSize: 12 }} />
            {analyte.levels.map((l, i) => (
              <Line
                key={l.id}
                type="monotone"
                dataKey={l.label}
                stroke={colors[i % colors.length]}
                dot={false}
                strokeWidth={2}
              />
            ))}
            {analyte.levels.map((l, i) =>
              l.criticalShift > 0 ? (
                <ReferenceLine
                  key={`ref-${l.id}`}
                  x={Number(l.criticalShift.toFixed(2))}
                  stroke={colors[i % colors.length]}
                  strokeDasharray="4 3"
                />
              ) : null
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const CURVE_COLORS = ["#0f766e", "#0891b2", "#7c3aed", "#b45309"];

/* Both charts live in the same axes: imprecision across, inaccuracy up.
   Every boundary is a straight line, bias = TEa - CV x slope. */
function OperatingChart({ analyte, settings, mode }) {
  const tea = effectiveTea(analyte);
  const z = settings.zAlpha;
  const target = settings.pedTarget / 100;

  const series = useMemo(() => {
    if (mode === "sigma") {
      return [6, 5, 4, 3].map((s) => ({
        key: `σ ${s}`,
        slope: s,
        color: { 6: "#047857", 5: "#0f766e", 4: "#b45309", 3: "#be123c" }[s],
      }));
    }
    return analyte.levels.map((l, i) => {
      const s90 = shiftForDetection(Number(l.k), l.n, target);
      return {
        key: `${l.label} rule K ${l.k}, n ${l.n}`,
        slope: isFinite(s90) ? s90 + z : Infinity,
        color: CURVE_COLORS[i % CURVE_COLORS.length],
      };
    });
  }, [analyte, mode, target, z]);

  const maxCv = useMemo(() => {
    const own = Math.max(...analyte.levels.map((l) => Number(l.cv) || 0));
    const slopes = series.map((s) => s.slope).filter((s) => isFinite(s));
    const reach = slopes.length ? tea / Math.min(...slopes) : own;
    return Math.max(own * 1.4, reach * 1.1, 0.5);
  }, [analyte, series, tea]);

  const data = useMemo(() => {
    const rows = [];
    const steps = 60;
    for (let i = 0; i <= steps; i++) {
      const cv = (maxCv * i) / steps;
      const row = { cv: Number(cv.toFixed(4)) };
      series.forEach((s) => {
        const y = tea - cv * s.slope;
        if (isFinite(y) && y >= 0) row[s.key] = Number(y.toFixed(4));
      });
      rows.push(row);
    }
    return rows;
  }, [series, maxCv, tea]);

  const explanation =
    mode === "sigma"
      ? "Each line is a sigma level. A point sitting below a line means the method reaches at least that sigma."
      : `Each line is the rule you chose for that level. A point below its own line means the rule reaches ${fmt(
          settings.pedTarget,
          0
        )}% detection at that imprecision and bias.`;

  return (
    <div className="mt-4">
      <p className="mb-3 max-w-2xl text-sm text-slate-600">{explanation}</p>
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 20, bottom: 24, left: 4 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 3" />
            <XAxis
              dataKey="cv"
              type="number"
              domain={[0, Number(maxCv.toFixed(3))]}
              tick={{ fontSize: 11, fill: "#475569" }}
              stroke="#94a3b8"
              tickFormatter={(v) => v.toFixed(1)}
              label={{
                value: "Imprecision, CV %",
                position: "insideBottom",
                offset: -12,
                fontSize: 11,
                fill: "#475569",
              }}
            />
            <YAxis
              type="number"
              domain={[0, Number(tea.toFixed(2))]}
              tick={{ fontSize: 11, fill: "#475569" }}
              stroke="#94a3b8"
              tickFormatter={(v) => v.toFixed(1)}
              label={{
                value: "Bias / offset %",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                fill: "#475569",
              }}
            />
            <Tooltip
              formatter={(v) => v.toFixed(2)}
              labelFormatter={(v) => `CV ${Number(v).toFixed(2)}%`}
              contentStyle={{ fontSize: 12, borderRadius: 4 }}
            />
            <Legend verticalAlign="top" align="right" height={22} wrapperStyle={{ fontSize: 12 }} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="linear"
                dataKey={s.key}
                stroke={s.color}
                dot={false}
                strokeWidth={2}
                isAnimationActive={false}
                connectNulls
              />
            ))}
            {analyte.levels.map((l, i) => {
              // Levels whose dots would land on top of each other get their
              // labels stacked beside the cluster instead of overprinted.
              const cx = Number(l.cv), cy = Math.abs(Number(l.bias) || 0);
              const near = analyte.levels
                .slice(0, i)
                .filter(
                  (o) =>
                    Math.abs(Number(o.cv) - cx) < maxCv * 0.06 &&
                    Math.abs(Math.abs(Number(o.bias) || 0) - cy) < tea * 0.08
                ).length;
              return (
                <ReferenceDot
                  key={l.id}
                  x={cx}
                  y={cy}
                  r={5}
                  fill={CURVE_COLORS[i % CURVE_COLORS.length]}
                  stroke="#ffffff"
                  strokeWidth={2}
                  label={(props) => {
                    const { x, y } = props.viewBox;
                    return near === 0 ? (
                      <text x={x} y={y - 9} textAnchor="middle" fontSize={11} fill="#334155">
                        {l.label}
                      </text>
                    ) : (
                      <text x={x + 9} y={y - 9 + near * 12} fontSize={11} fill="#334155">
                        {l.label}
                      </text>
                    );
                  }}
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analyte panel                                                       */
/* ------------------------------------------------------------------ */

/* Named allowable-error sources for one analyte (Noklus, CLIA, Rili-BÄK, …).
   Each entry becomes a choice in the selector and a card in the comparison row. */
function SourceEditor({ analyte, onChange }) {
  const [label, setLabel] = useState("");
  const [value, setValue] = useState("");
  const listId = `src-${analyte.id}`;
  const listed = analyte.teaOptions || [];
  const add = () => {
    const l = label.trim();
    const v = Number(String(value).replace(",", "."));
    if (!l || !(v > 0)) return;
    const next = [...listed.filter((o) => o.label !== l), { label: l, value: v }].sort(
      (a, b) => a.value - b.value
    );
    const patch = { ...analyte, teaOptions: next };
    if (!(Number(analyte.tea) > 0)) Object.assign(patch, { teaSource: l, tea: v });
    onChange(patch);
    setLabel("");
    setValue("");
  };
  const remove = (l) => {
    const next = listed.filter((o) => o.label !== l);
    const patch = { ...analyte, teaOptions: next };
    if (analyte.teaSource === l) Object.assign(patch, { teaSource: "Custom" });
    onChange(patch);
  };
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-slate-600">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Allowable error sources
      </span>
      {listed.length === 0 && (
        <span className="text-xs text-slate-500">none entered yet</span>
      )}
      {listed.map((o) => (
        <span
          key={o.label}
          className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-0.5 font-mono text-xs text-slate-800"
        >
          {o.label} {fmt(o.value, 2)}%
          <button
            type="button"
            onClick={() => remove(o.label)}
            className="ml-1 text-slate-400 hover:text-rose-700"
            title={`Remove ${o.label}`}
          >
            ×
          </button>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <input
          list={listId}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="Source"
          className="w-36 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
        />
        <datalist id={listId}>
          {SOURCE_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <input
          type="number"
          step="any"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="TEa"
          className="w-16 rounded border border-slate-300 bg-white px-2 py-1 text-right font-mono text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
        />
        <span className="font-mono text-slate-500">%</span>
        <button
          type="button"
          onClick={add}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
        >
          Add source
        </button>
      </span>
    </div>
  );
}

function AnalytePanel({ analyte, settings, onChange, onRemove }) {
  const [chart, setChart] = useState("none");
  const [strategy, setStrategy] = useState("ends");
  const [suggestion, setSuggestion] = useState(null);

  const setLevel = (id, patch) =>
    onChange({
      ...analyte,
      levels: analyte.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });

  const runSearch = () => {
    const raw = {
      ...analyte,
      levels: analyte.levels.map((l) => ({ ...l })),
    };
    const result = searchRules(raw, settings, strategy);
    setSuggestion(result);
  };

  const applySuggestion = () => {
    if (!suggestion) return;
    onChange({
      ...analyte,
      levels: analyte.levels.map((l, i) => ({ ...l, k: suggestion.ks[i] })),
    });
    setSuggestion(null);
  };

  const addLevel = () =>
    onChange({
      ...analyte,
      levels: [
        ...analyte.levels,
        lvl(`L${analyte.levels.length + 1}`, 1, 1, 2, 3),
      ],
    });

  const removeLevel = (id) => {
    if (analyte.levels.length <= 1) return;
    onChange({ ...analyte, levels: analyte.levels.filter((x) => x.id !== id) });
    setSuggestion(null);
  };

  return (
    <section className="border border-slate-300 bg-white">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-slate-200 px-4 py-3">
        <input
          value={analyte.name}
          onChange={(e) => onChange({ ...analyte, name: e.target.value })}
          className="w-44 border-b border-transparent bg-transparent text-base font-semibold text-slate-900 hover:border-slate-300 focus:border-teal-600 focus:outline-none"
        />

        <label className="flex items-center gap-2 text-sm text-slate-600">
          Allowable total error
          <select
            value={analyte.teaSource}
            onChange={(e) => {
              const opt = teaOptionsFor(analyte).find((o) => o.label === e.target.value);
              onChange({
                ...analyte,
                teaSource: e.target.value,
                tea: opt ? opt.value : analyte.tea,
              });
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
          >
            {teaOptionsFor(analyte).map((o) => (
              <option key={o.label} value={o.label}>
                {o.label}
                {o.computed ? ` (${fmt(o.value, 1)}%)` : ""}
              </option>
            ))}
            <option value="Custom">Custom</option>
          </select>
          <NumberCell
            value={
              teaOptionsFor(analyte).some((o) => o.computed && o.label === analyte.teaSource)
                ? Number(effectiveTea(analyte).toFixed(2))
                : analyte.tea
            }
            onChange={(v) => onChange({ ...analyte, tea: v, teaSource: "Custom" })}
            width="w-16"
          />
          <span className="font-mono text-sm text-slate-500">%</span>
        </label>

        <label
          className="flex items-center gap-2 text-sm text-slate-600"
          title="Within-subject (CVI) and between-subject (CVG) biological variation, from the EFLM database. Fill both and the optimal, desirable and minimum tiers appear as sources."
        >
          BV
          <span className="text-xs text-slate-500">CV<sub>I</sub></span>
          <NumberCell
            value={(analyte.bv && analyte.bv.cvi) ?? ""}
            onChange={(v) => onChange({ ...analyte, bv: { ...(analyte.bv || {}), cvi: v } })}
            width="w-14"
          />
          <span className="text-xs text-slate-500">CV<sub>G</sub></span>
          <NumberCell
            value={(analyte.bv && analyte.bv.cvg) ?? ""}
            onChange={(v) => onChange({ ...analyte, bv: { ...(analyte.bv || {}), cvg: v } })}
            width="w-14"
          />
          <span className="font-mono text-sm text-slate-500">%</span>
        </label>

        <div className="ml-auto flex items-center gap-2">
          {(() => {
            const worst = Math.min(...analyte.levels.map((l) => l.sigma));
            const band = sigmaBand(worst);
            if (!band) return null;
            return (
              <span
                className={`rounded px-2 py-0.5 font-mono text-xs ${TONE[band.tone]}`}
                title={band.plan}
              >
                σ {fmt(worst, 1)} · {band.label}
              </span>
            );
          })()}
          {analyte.ready ? (
            <>
              <Verdict ok={analyte.pfrOk}>
                False alarms {fmt(analyte.combinedPfr * 100, 2)}%
              </Verdict>
              {analyte.anyOffset && (
                <Verdict ok={analyte.pfrOffsetOk}>
                  With offset {fmt(analyte.combinedPfrOffset * 100, 2)}%
                </Verdict>
              )}
              <Verdict ok={analyte.pedOk}>
                Detection {fmt(analyte.combinedPed * 100, 1)}%
              </Verdict>
            </>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              Needs {analyte.missing.join(", ")}
            </span>
          )}
        </div>
      </header>

      <div className="px-4 py-4">
        <div className="mb-4">
          <BudgetMeter
            levels={analyte.levels}
            combinedPfr={analyte.combinedPfr}
            budget={settings.pfrBudget}
          />
        </div>

        {(() => {
          const worst = Math.min(...analyte.levels.map((l) => l.sigma));
          const band = sigmaBand(worst);
          if (!band) return null;
          return (
            <p className="mb-4 border-l-2 border-slate-300 pl-3 text-sm text-slate-600">
              Weakest level runs at sigma {fmt(worst, 1)}. Published sigma schemes
              would ask for: {band.plan.charAt(0).toLowerCase() + band.plan.slice(1)}
            </p>
          );
        })()}

        <SourceEditor analyte={analyte} onChange={onChange} />

        {teaOptionsFor(analyte).length > 1 && (
          <div className="mb-4 border border-slate-200 bg-slate-50 px-3 py-2.5">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
              Same measurement, different specification
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {teaOptionsFor(analyte).map((o) => {
                const worstCv = Math.max(...analyte.levels.map((l) => l.cv));
                const s = worstCv > 0 ? o.value / worstCv : NaN;
                const band = sigmaBand(s);
                const active = o.label === analyte.teaSource;
                return (
                  <button
                    key={o.label}
                    type="button"
                    onClick={() =>
                      onChange({ ...analyte, teaSource: o.label, tea: o.value })
                    }
                    className={`rounded border px-2 py-1 text-left transition ${
                      active
                        ? "border-teal-600 bg-white"
                        : "border-slate-300 bg-white hover:border-slate-400"
                    }`}
                    title={`Set allowable total error to ${o.value}%`}
                  >
                    <span className="block text-xs text-slate-600">{o.label}</span>
                    <span className="block font-mono text-xs text-slate-900">
                      {fmt(o.value, 1)}% · &sigma;&nbsp;{fmt(s, 1)}
                    </span>
                    {band && (
                      <span
                        className={`mt-0.5 block rounded px-1 text-[10px] ${TONE[band.tone]}`}
                      >
                        {band.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {(() => {
              const vals = teaOptionsFor(analyte).map((o) => o.value);
              const lo = Math.min(...vals);
              const hi = Math.max(...vals);
              if (!(hi > lo)) return null;
              return (
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  Across the published sources the target ranges from {fmt(lo, 1)}% to{" "}
                  {fmt(hi, 1)}%, a {fmt(hi / lo, 1)}-fold spread in sigma for the same
                  instrument, the same control material and the same imprecision. False
                  alarm rates do not move at all, since they depend only on the rule.
                </p>
              );
            })()}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
                <th className="py-2 pr-3 font-medium">Level</th>
                <th className="py-2 pr-3 font-medium">Target</th>
                <th className="py-2 pr-3 font-medium">CV %</th>
                <th className="py-2 pr-3 font-medium" title="Systematic error, or the offset of the analyser mean from the target">Bias / offset %</th>
                <th className="py-2 pr-3 font-medium">Controls</th>
                <th className="py-2 pr-3 font-medium">Rule (K)</th>
                <th className="py-2 pr-3 text-right font-medium">Sigma</th>
                <th className="py-2 pr-3 text-right font-medium">Critical shift</th>
                <th className="py-2 pr-3 text-right font-medium">False alarm</th>
                <th
                  className="py-2 pr-3 text-right font-medium"
                  title="Offset of the analyser mean from the target, in SD units (bias divided by CV)"
                >
                  Offset (SD)
                </th>
                <th
                  className="py-2 pr-3 text-right font-medium"
                  title="False alarm rate once the control distribution is off-centre by that offset"
                >
                  False alarm, offset
                </th>
                <th className="py-2 pr-3 text-right font-medium">Detection</th>
                <th className="py-2 pr-3 text-right font-medium">Action limit</th>
                <th className="py-2 pr-3 text-right font-medium">Accepted range</th>
                <th className="py-2 pr-3 text-right font-medium">SD for LIS</th>
                <th className="py-2 pr-3 text-right font-medium">
                  Maker range
                </th>
                <th className="py-2 pr-3 text-right font-medium">Maker K</th>
                <th className="py-2 pr-3 text-right font-medium">
                  Maker detection
                </th>
              </tr>
            </thead>
            <tbody>
              {analyte.levels.map((l) => {
                const d = sigDigits(l.target);
                return (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1">
                        <input
                          value={l.label}
                          onChange={(e) => setLevel(l.id, { label: e.target.value })}
                          className="w-12 rounded border border-transparent bg-transparent px-1 py-1 font-mono text-sm text-slate-900 hover:border-slate-300 focus:border-teal-600 focus:outline-none"
                        />
                        {analyte.levels.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeLevel(l.id)}
                            title="Remove this level"
                            className="rounded px-1 text-xs text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                          >
                            &times;
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <NumberCell
                        value={l.target}
                        onChange={(v) => setLevel(l.id, { target: v })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberCell
                        value={l.cv}
                        onChange={(v) => setLevel(l.id, { cv: v })}
                        width="w-16"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberCell
                        value={l.bias}
                        onChange={(v) => setLevel(l.id, { bias: v })}
                        width="w-16"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <NumberCell
                        value={l.n}
                        onChange={(v) => setLevel(l.id, { n: v })}
                        width="w-14"
                        step="1"
                        min="1"
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center gap-1.5">
                        <NumberCell
                          value={l.k}
                          onChange={(v) => setLevel(l.id, { k: v })}
                          width="w-16"
                          step="0.1"
                        />
                        <label
                          className="cursor-pointer text-xs text-slate-500"
                          title="Keep this rule fixed when searching"
                        >
                          <input
                            type="checkbox"
                            checked={!!l.locked}
                            onChange={(e) =>
                              setLevel(l.id, { locked: e.target.checked })
                            }
                            className="mr-1 align-middle accent-teal-700"
                          />
                          fixed
                        </label>
                      </div>
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono font-semibold ${
                        l.sigma >= 6
                          ? "text-emerald-800"
                          : l.sigma >= 4
                          ? "text-teal-800"
                          : l.sigma >= 3
                          ? "text-amber-800"
                          : "text-rose-700"
                      }`}
                      title={`TEa in SD units: ${fmt(l.teaAsSd)}`}
                    >
                      {fmt(l.sigma)}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono ${
                        l.criticalShift <= 0 ? "text-rose-700" : "text-slate-700"
                      }`}
                    >
                      {fmt(l.criticalShift)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-700">
                      {fmt(l.pfr * 100, 2)}%
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-600">
                      {l.offsetSd > 0 ? fmt(l.offsetSd, 2) : "—"}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono ${
                        l.pfrOffset > l.pfr * 2
                          ? "text-rose-700"
                          : l.offsetSd > 0
                          ? "text-amber-800"
                          : "text-slate-400"
                      }`}
                    >
                      {l.offsetSd > 0 ? `${fmt(l.pfrOffset * 100, 2)}%` : "—"}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono ${
                        l.ped >= 0.9
                          ? "text-emerald-800"
                          : l.ped >= 0.7
                          ? "text-amber-800"
                          : "text-slate-500"
                      }`}
                    >
                      {fmt(l.ped, 3)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-700">
                      ±{fmt(l.actionLimit, d)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-500">
                      {fmt(l.lower, d)} – {fmt(l.upper, d)}
                    </td>
                    <td className="py-2 pr-3 text-right font-mono font-semibold text-slate-900">
                      {fmt(l.sdForLis, d + 1)}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      <NumberCell
                        value={l.mfrRange ?? 0}
                        onChange={(v) => setLevel(l.id, { mfrRange: v })}
                        width="w-20"
                      />
                    </td>
                    <td className="py-2 pr-3 text-right font-mono text-slate-600">
                      {l.hasMfr ? fmt(l.mfrK, 1) : "—"}
                    </td>
                    <td
                      className={`py-2 pr-3 text-right font-mono ${
                        l.hasMfr && l.mfrPed < l.ped ? "text-rose-700" : "text-slate-600"
                      }`}
                      title={
                        l.hasMfr
                          ? `False alarms with the maker range: ${fmt(l.mfrPfr * 100, 2)}%`
                          : ""
                      }
                    >
                      {l.hasMfr ? fmt(l.mfrPed, 3) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {(() => {
          if (!analyte.ready) return null;
          const hasReq = analyte.pedReq || analyte.pedReq === 0;
          return (
            <div className="mt-4 border border-slate-200 bg-slate-50 px-3 py-2.5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                {hasReq
                  ? `Imprecision you can afford (detection \u2265 ${analyte.pedReq}%)`
                  : "Imprecision for a target sigma (no detection requirement set)"}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500">
                    <th className="py-1 pr-3 font-medium">Level</th>
                    <th className="py-1 pr-3 text-right font-medium">Measured CV</th>
                    {hasReq ? (
                      <>
                        <th className="py-1 pr-3 text-right font-medium">Max CV, current rule</th>
                        <th className="py-1 pr-3 text-right font-medium">Max CV, best rule</th>
                        <th className="py-1 pr-3 font-medium">Headroom</th>
                      </>
                    ) : (
                      <>
                        <th className="py-1 pr-3 text-right font-medium">CV for &sigma;&nbsp;3</th>
                        <th className="py-1 pr-3 text-right font-medium">CV for &sigma;&nbsp;4</th>
                        <th className="py-1 pr-3 text-right font-medium">CV for &sigma;&nbsp;6</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {analyte.levels.map((l, i) => {
                    const cv = Number(l.cv);
                    if (!hasReq) {
                      return (
                        <tr key={l.id} className="border-t border-slate-200">
                          <td className="py-1 pr-3 font-mono text-slate-700">{l.label}</td>
                          <td className="py-1 pr-3 text-right font-mono text-slate-900">{fmt(cv, 2)}%</td>
                          <td className="py-1 pr-3 text-right font-mono text-slate-600">{fmt(cvForSigma(analyte, i, 3), 2)}%</td>
                          <td className="py-1 pr-3 text-right font-mono text-slate-600">{fmt(cvForSigma(analyte, i, 4), 2)}%</td>
                          <td className="py-1 pr-3 text-right font-mono text-slate-600">{fmt(cvForSigma(analyte, i, 6), 2)}%</td>
                        </tr>
                      );
                    }
                    const mFix = maxCvForLevel(analyte, settings, i, false);
                    const mBest = maxCvForLevel(analyte, settings, i, true);
                    const show = (v) =>
                      v === Infinity ? "not binding" : v === 0 ? "\u2014" : fmt(v, 2) + "%";
                    const ok = mFix === Infinity || (isFinite(mFix) && cv <= mFix + 1e-9);
                    return (
                      <tr key={l.id} className="border-t border-slate-200">
                        <td className="py-1 pr-3 font-mono text-slate-700">{l.label}</td>
                        <td className="py-1 pr-3 text-right font-mono text-slate-900">{fmt(cv, 2)}%</td>
                        <td className="py-1 pr-3 text-right font-mono text-slate-700">{show(mFix)}</td>
                        <td className="py-1 pr-3 text-right font-mono text-slate-700">{show(mBest)}</td>
                        <td className="py-1 pr-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
                            }`}
                          >
                            {ok ? "within reach" : "CV too high"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {hasReq && (
                <p className="mt-2 text-xs leading-relaxed text-slate-600">
                  The largest CV at which the combined detection still meets{" "}
                  {analyte.pedReq}%, holding the other levels at their measured CV.
                  &ldquo;Current rule&rdquo; keeps K as set; &ldquo;best rule&rdquo;
                  lets the search re-tune K across levels. Where the measured CV is
                  above the limit, lower imprecision or re-optimise the rule.
                </p>
              )}
            </div>
          );
        })()}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={strategy}
            onChange={(e) => {
              setStrategy(e.target.value);
              setSuggestion(null);
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
          >
            <option value="ends">Favour lowest and highest level</option>
            <option value="l1">Favour lowest level</option>
            <option value="balanced">Best combined detection</option>
          </select>
          <button
            onClick={runSearch}
            className="rounded bg-teal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:ring-offset-1"
          >
            Search for rules
          </button>

          {suggestion && (
            <div className="flex flex-wrap items-center gap-3 rounded border border-teal-200 bg-teal-50 px-3 py-1.5">
              <span className="font-mono text-sm text-teal-900">
                K = {suggestion.ks.join(" / ")}
              </span>
              <span className="font-mono text-xs text-teal-800">
                false alarms {fmt(suggestion.combinedPfr * 100, 2)}% · detection{" "}
                {fmt(suggestion.combinedPed * 100, 1)}%
              </span>
              <button
                onClick={applySuggestion}
                className="rounded bg-teal-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-900"
              >
                Apply
              </button>
              <button
                onClick={() => setSuggestion(null)}
                className="text-xs text-teal-800 underline hover:text-teal-950"
              >
                Dismiss
              </button>
            </div>
          )}

          {suggestion === null && (
            <span className="text-xs text-slate-500">
              Fix a level first if you want it left alone.
            </span>
          )}

          <div className="ml-auto flex items-center gap-3">
            <select
              value={chart}
              onChange={(e) => setChart(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
            >
              <option value="none">No chart</option>
              <option value="power">Power curves</option>
              <option value="opspecs">Operating specifications</option>
              <option value="sigma">Method decision chart</option>
            </select>
            <button
              onClick={addLevel}
              className="text-sm text-slate-600 underline hover:text-slate-900"
            >
              Add level
            </button>
            <button
              onClick={onRemove}
              className="text-sm text-rose-700 underline hover:text-rose-900"
            >
              Remove analyte
            </button>
          </div>
        </div>

        <textarea
          value={analyte.note}
          onChange={(e) => onChange({ ...analyte, note: e.target.value })}
          placeholder="Why this rule was chosen. This text goes into the export."
          rows={2}
          className="mt-4 w-full resize-y rounded border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:outline-none"
        />

        {chart !== "none" && (
          <div className="mt-4 border-t border-slate-200 pt-4">
            {chart === "power" ? (
              <PowerCurves analyte={analyte} settings={settings} />
            ) : (
              <OperatingChart
                analyte={analyte}
                settings={settings}
                mode={chart === "sigma" ? "sigma" : "opspecs"}
              />
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function ComparisonView({ computed, settings }) {
  const withMfr = computed.filter((a) => a.hasMfr);

  const chartData = withMfr.map((a) => ({
    name: a.name,
    "Laboratory rule": Number((a.combinedPed * 100).toFixed(1)),
    "Maker range": Number((a.combinedMfrPed * 100).toFixed(1)),
  }));

  if (!withMfr.length) {
    return (
      <div className="max-w-3xl pb-6 text-sm leading-relaxed text-slate-700">
        <p>
          Nothing to compare yet. Enter the acceptable range the manufacturer states
          for each control level in the maker range column on the rule design tab, and
          this page will show what that range is worth on your own instrument.
        </p>
      </div>
    );
  }

  return (
    <div className="pb-6">
      <div className="mb-6 max-w-3xl space-y-3 text-sm leading-relaxed text-slate-700">
        <p>
          A manufacturer states an acceptable range without knowing your instrument.
          Divide that range by the standard deviation you actually observe and it
          turns into a control rule, which can then be judged the same way as the one
          you designed.
        </p>
        <p>
          Both columns use your own imprecision and your own allowable total error.
          The only thing that differs is where the limit sits.
        </p>
      </div>

      <div className="mb-8 h-80 w-full border border-slate-300 bg-white p-4">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 16, bottom: 40, left: 4 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 3" vertical={false} />
            <XAxis
              dataKey="name"
              tick={{ fontSize: 11, fill: "#475569" }}
              stroke="#94a3b8"
              angle={-35}
              textAnchor="end"
              interval={0}
              height={60}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "#475569" }}
              stroke="#94a3b8"
              label={{
                value: "Combined detection %",
                angle: -90,
                position: "insideLeft",
                fontSize: 11,
                fill: "#475569",
              }}
            />
            <Tooltip
              formatter={(v) => `${v}%`}
              contentStyle={{ fontSize: 12, borderRadius: 4 }}
            />
            <Legend verticalAlign="top" align="right" height={22} wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine
              y={settings.pedTarget}
              stroke="#0f172a"
              strokeDasharray="4 3"
            />
            <Bar dataKey="Laboratory rule" fill="#0f766e" isAnimationActive={false} />
            <Bar dataKey="Maker range" fill="#cbd5e1" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="overflow-x-auto border border-slate-300 bg-white">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 bg-slate-50 text-left text-xs text-slate-600">
              <th className="px-3 py-2 font-medium">Analyte</th>
              <th className="px-3 py-2 font-medium">Level</th>
              <th className="px-3 py-2 text-right font-medium">Your K</th>
              <th className="px-3 py-2 text-right font-medium">Maker K</th>
              <th className="px-3 py-2 text-right font-medium">Detection, yours</th>
              <th className="px-3 py-2 text-right font-medium">Detection, maker</th>
              <th className="px-3 py-2 text-right font-medium">Difference</th>
              <th className="px-3 py-2 text-right font-medium">False alarms, yours</th>
              <th className="px-3 py-2 text-right font-medium">False alarms, maker</th>
            </tr>
          </thead>
          <tbody>
            {withMfr.map((a) =>
              a.levels.map((l, i) => {
                const diff = l.ped - l.mfrPed;
                return (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="px-3 py-2 text-slate-900">{i === 0 ? a.name : ""}</td>
                    <td className="px-3 py-2 font-mono text-slate-600">{l.label}</td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">
                      {fmt(l.k, 1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">
                      {fmt(l.mfrK, 1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-900">
                      {fmt(l.ped, 3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">
                      {fmt(l.mfrPed, 3)}
                    </td>
                    <td
                      className={`px-3 py-2 text-right font-mono ${
                        diff > 0.02
                          ? "text-teal-800"
                          : diff < -0.02
                          ? "text-amber-800"
                          : "text-slate-400"
                      }`}
                    >
                      {diff > 0 ? "+" : ""}
                      {fmt(diff, 3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-700">
                      {fmt(l.pfr * 100, 2)}%
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-slate-600">
                      {fmt(l.mfrPfr * 100, 2)}%
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-3xl text-sm leading-relaxed text-slate-600">
        A positive difference means your own limit catches more of the error that
        matters. A negative one means the manufacturer's range is the tighter of the
        two at that level, which happens and is worth reporting rather than hiding.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Method guide                                                        */
/* ------------------------------------------------------------------ */

function Formula({ children }) {
  return (
    <p className="my-3 border-l-2 border-teal-700 bg-slate-50 px-4 py-2.5 font-mono text-sm text-slate-800">
      {children}
    </p>
  );
}

function Section({ title, children }) {
  return (
    <section className="mb-9">
      <h2 className="mb-2 text-lg font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      <div className="max-w-3xl space-y-3 text-sm leading-relaxed text-slate-700">
        {children}
      </div>
    </section>
  );
}

function MethodGuide({ settings }) {
  return (
    <div className="pb-6">
      <Section title="What the two probabilities mean">
        <p>
          Every control rule is a compromise between crying wolf and missing a real
          problem. The two numbers that measure this are the only thing you are
          really tuning.
        </p>
        <p>
          <span className="font-semibold text-slate-900">False alarm rate</span> is
          the chance a run gets rejected when nothing is wrong and the analyser is
          only showing its normal scatter. At 0.54% you would stop the line for no
          reason roughly five times in a thousand control events.
        </p>
        <p>
          <span className="font-semibold text-slate-900">Detection rate</span> is the
          chance the rule catches a shift of the size that would actually make
          results clinically wrong. At 0.70 you catch seven such shifts out of ten
          and miss three.
        </p>
        <p>
          Tightening a rule raises both. Widening it lowers both. There is no setting
          that improves one without paying in the other, which is why this is a design
          decision and not a calculation.
        </p>
      </Section>

      <Section title="How each number is worked out">
        <p>
          Start from the imprecision you measured and the total error you are willing
          to allow. Divide one by the other and you get the allowable error expressed
          in standard deviations. Subtract any known bias and you have the sigma
          metric:
        </p>
        <Formula>sigma = (TEa% − bias%) ÷ CV%</Formula>
        <p>
          A rule cannot be expected to catch a shift right up to the edge of the
          allowable error, because half the time normal scatter would carry the result
          past that edge anyway. Subtracting {settings.zAlpha} leaves a 5% margin and
          gives the shift the rule genuinely has to detect:
        </p>
        <Formula>critical shift = sigma − {settings.zAlpha}</Formula>
        <p>
          The rest is the normal distribution. A single control result stays inside
          ±K with a probability you can read off the curve; n results all stay inside
          with that probability raised to the power n; the rule fires when at least
          one falls outside:
        </p>
        <Formula>
          false alarm = 1 − P(inside ±K)ⁿ
          <br />
          detection = 1 − P(inside ±K, distribution shifted by the critical shift)ⁿ
        </Formula>
        <p>
          When the critical shift comes out at or below zero, the imprecision has
          eaten the whole error budget. No choice of K helps, and the tool marks the
          value in red.
        </p>
      </Section>

      <Section title="Why the levels are judged together">
        <p>
          The three control levels run in the same event, so what matters is whether{" "}
          <em>any</em> of them fires. Their individual probabilities combine:
        </p>
        <Formula>combined = 1 − (1 − p₁)(1 − p₂)(1 − p₃)</Formula>
        <p>
          This is what makes the false alarm allowance behave like a budget. If two
          levels already spend 1.35% of a 1.5% allowance, the third can only have
          0.15% left, and its rule has to be wide enough to fit. Spending that
          allowance where it buys the most detection is the whole exercise.
        </p>
        <p>
          It also means a weak level is not automatically a problem. A low level with
          a detection rate of 0.24 looks alarming on its own, but if the other two
          levels catch the same shift the combined figure still reaches 1.00.
        </p>
      </Section>

      <Section title="Choosing K">
        <p>
          K is the width of the action limits in standard deviations. It is not
          calculated for you anywhere, in this tool or in a spreadsheet. You pick it,
          look at what happens, and pick again.
        </p>
        <p>
          It does not have to be a whole number. K = 3.7 simply means the action limit
          sits at 3.7 standard deviations, and intermediate values are often what let
          you fit inside the allowance without giving up much.
        </p>
        <p>
          The search button does the picking by brute force: it tries every
          combination between 1.5 and 5.0 in steps of 0.1, throws away anything over
          the false alarm allowance, and keeps the best survivor. Which survivor
          counts as best depends on the strategy you choose, because favouring the
          pathological levels and maximising the combined figure often point at
          different answers. Fix a level first if you want it left alone.
        </p>
      </Section>

      <Section title="Reading the three charts">
        <p>
          <span className="font-semibold text-slate-900">Power curves</span> plot
          detection against the size of a shift, with a dashed line at each level's
          critical shift. Where a curve crosses its dashed line is the detection rate
          in the table. If the dashed line sits far to the left, under the flat part
          of the curve, the analyte cannot be rescued by rule selection.
        </p>
        <p>
          <span className="font-semibold text-slate-900">
            Operating specifications
          </span>{" "}
          turns the question around: given the rule you chose, how much imprecision
          and bias can the method have and still reach your detection target? Each
          line is one level's rule, and each dot is that level's real performance. A
          dot below its own line passes. Every boundary is straight because the
          condition works out to bias ≤ TEa − CV × (shift + {settings.zAlpha}).
        </p>
        <p>
          <span className="font-semibold text-slate-900">Method decision chart</span>{" "}
          uses the same axes but draws fixed sigma levels instead of rules, so you can
          see at a glance which band each control level falls into.
        </p>
      </Section>

      <Section title="Sigma bands and what they ask for">
        <p>
          Sigma compresses everything into one number, which is coarser than the
          probabilities above but useful for deciding how often to run controls. The
          bands below are the scheme proposed by Cooper and colleagues (reference 4).
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
                <th className="py-2 pr-6 font-medium">Sigma</th>
                <th className="py-2 pr-6 font-medium">Verdict</th>
                <th className="py-2 font-medium">Control plan</th>
              </tr>
            </thead>
            <tbody>
              {[6, 5, 3.5, 2].map((s) => {
                const b = sigmaBand(s);
                const range = { 6: "6 and above", 5: "4 to 6", 3.5: "3 to 4", 2: "below 3" }[s];
                return (
                  <tr key={s} className="border-b border-slate-100">
                    <td className="py-2 pr-6 font-mono text-slate-700">{range}</td>
                    <td className="py-2 pr-6">
                      <span className={`rounded px-2 py-0.5 font-mono text-xs ${TONE[b.tone]}`}>
                        {b.label}
                      </span>
                    </td>
                    <td className="py-2 text-slate-700">{b.plan}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3">
          Treat this as a second opinion rather than a verdict. It says nothing about
          which level matters clinically, and it assumes one rule for the whole
          analyte.
        </p>
      </Section>

      <Section title="Getting the numbers into the analyser">
        <p>
          Most quality management systems apply a fixed ±3 SD rule and let you set
          only the standard deviation. So the standard deviation you enter has to be
          the action limit you designed, divided by that fixed width:
        </p>
        <Formula>SD to enter = action limit ÷ {settings.qmMultiplier}</Formula>
        <p>
          Nothing here talks to your laboratory system. Changing a rule in this tool
          changes nothing on the bench until someone types the new standard deviation
          in, and that should happen only after the change has been authorised.
        </p>
      </Section>

      <Section title="A working order">
        <ol className="ml-4 list-decimal space-y-2 marker:text-slate-400">
          <li>
            Enter the imprecision from your most recent lot, taking the highest CV per
            instrument and level if you run more than one analyser.
          </li>
          <li>
            Decide the allowable total error and record where it came from. This is
            the choice that moves everything else, and it deserves a written reason.
          </li>
          <li>
            Set every level to K = 3 and look at the combined false alarm figure. If
            it is over the allowance, something has to widen.
          </li>
          <li>
            Widen the level that loses the least. Usually that is the level in the
            normal range, or the level whose detection is already saturated.
          </li>
          <li>
            Check the combined detection still clears your target, and write down why
            you settled where you did.
          </li>
          <li>Export, get it authorised, then update the analyser.</li>
        </ol>
      </Section>

      <Section title="Where this stops helping">
        <p>
          The arithmetic assumes results are normally distributed, that control
          measurements are independent, and that the only error worth modelling is a
          sustained shift. Increased scatter, drift within a run and carryover are all
          outside it.
        </p>
        <p>
          It also assumes the CV you typed is real. A CV from too few points, or from
          a period when the instrument happened to behave, will make every figure on
          the screen look better than the bench.
        </p>
        <p>
          When an analyte comes out with a critical shift under one standard
          deviation, no rule on the grid will help, and it is tempting to conclude
          that the measurement is beyond control. Check the specification before
          accepting that. In this panel MCV, MCH and MCHC all looked uncontrollable
          at the biological variation minimum and all three sit at sigma 8 against
          the external assessment limit, on identical data. The question of which
          target is right is a policy question about clinical need, but it should be
          asked deliberately rather than settled by whichever source was entered
          first.
        </p>
        <p>
          Where a specification is genuinely unattainable and the tightest defensible
          source has already been chosen, control rules are not the right instrument
          and patient based checks such as moving averages carry the real weight.
        </p>
        <p>
          One failure mode is worth naming because it is invisible: if allowable
          error in standard deviation units is entered as a fixed number rather than
          recomputed from the current CV, every detection figure downstream is wrong
          while still looking plausible. Recompute it whenever imprecision is
          refreshed.
        </p>
      </Section>

      <Section title="Implementation and reproducibility">
        <p>
          Normal probabilities are evaluated through the regularised incomplete gamma
          function with a = ½, using the series expansion below x² = 1.5 and the
          continued fraction above it, both iterated to a relative tolerance of
          10⁻¹⁶. This is used instead of a polynomial approximation to the error
          function because the false rejection rates of interest lie in the far tail,
          where common approximations carry a relative error of several tenths of a
          percent at K above 4.
        </p>
        <p>
          The rule search enumerates K from 1.5 to 5.0 in steps of 0.1 at every level,
          discards any combination whose combined false rejection exceeds the stated
          allowance, and returns the survivor scoring highest under the selected
          objective. Levels marked as fixed are held at their entered value. The shift
          at which a rule reaches the detection target is found by bisection over 0 to
          30 standard deviations across 80 iterations.
        </p>
        <p>
          The calculation engine is the one used in the companion hematology tool,
          whose outputs were checked against an independent implementation in SciPy
          and against the laboratory's rule-design spreadsheet. Agreement was
          exact to the reported precision for false rejection, detection and combined
          figures, and to seven significant figures for the underlying tail
          probabilities.
        </p>
        <p>
          No data leave the browser. Entries are held in local browser storage on the
          user's own device and are not transmitted anywhere.
        </p>
      </Section>

      <Section title="Reporting rules selected with this tool">
        <p>
          Control rule designer for clinical chemistry and immunochemistry, version 1.0. State the allowable total
          error and its source for each analyte, the imprecision estimate and the
          period it came from, the false rejection allowance and detection target
          applied, and the control rule and number of control measurements at each
          level. Report the combined figures alongside the individual ones, since a
          level can fail on its own while the control event as a whole performs
          adequately.
        </p>
      </Section>

      <Section title="References">
        <ol className="ml-4 list-decimal space-y-2 marker:text-slate-400">
          <li>
            Westgard JO, Groth T, Aronsson T, et al. Performance characteristics of
            rules for internal quality control: probabilities for false rejection and
            error detection. Clin Chem 1977;23:1857–67.
          </li>
          <li>
            Westgard JO, Groth T. Power functions for statistical control rules. Clin
            Chem 1979;25:863–9.
          </li>
          <li>
            Westgard JO, Barry PL, Hunt MR, Groth T. A multirule Shewhart chart for
            quality control in clinical chemistry. Clin Chem 1981;27:493–501.
          </li>
          <li>
            Cooper G, de Jonge N, Ehrmeyer S, et al. Collective opinion paper on
            findings of the 2010 convocation of experts on laboratory quality. Clin
            Chem Lab Med 2011;49:793.
          </li>
          <li>
            Kinns H, Pitkin S, Housley D, Freedman DB. Internal quality control: best
            practice. J Clin Pathol 2013;66:1027–32.
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          The false rejection and error detection framework comes from references 1
          to 3. The sigma bands and the control plans attached to them are reference
          4. Verify page numbers against the publisher record before submission.
        </p>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const STORE_KEY = "designlabiqc-clinchem-v1";

export default function IqcRuleDesigner() {
  const [analytes, setAnalytes] = useState(DEFAULT_ANALYTES);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("Loading saved work…");
  const [tab, setTab] = useState("design");
  const [importNote, setImportNote] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(STORE_KEY);
        if (!cancelled && res && res.value) {
          const parsed = JSON.parse(res.value);
          if (parsed.analytes) setAnalytes(parsed.analytes);
          if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
          setStatus("Saved work restored");
        } else if (!cancelled) {
          setStatus("Starting from the cobas pro panel");
        }
      } catch (e) {
        if (!cancelled) setStatus("Starting from the cobas pro panel");
      } finally {
        loaded.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    const t = setTimeout(async () => {
      try {
        await window.storage.set(STORE_KEY, JSON.stringify({ analytes, settings }));
        setStatus("Saved");
      } catch (e) {
        setStatus("Could not save — your changes stay in this session only");
      }
    }, 600);
    return () => clearTimeout(t);
  }, [analytes, settings]);

  const computed = useMemo(
    () => analytes.map((a) => computeAnalyte(a, settings)),
    [analytes, settings]
  );

  const failing = computed.filter((a) => a.ready && (!a.pfrOk || !a.pedOk));
  const incomplete = computed.filter((a) => !a.ready);
  const panels = [...PANELS, ...analytes.map((a) => a.panel || "Imported")].filter(
    (p, i, all) => all.indexOf(p) === i
  );

  const updateAnalyte = (id, next) =>
    setAnalytes((prev) => prev.map((a) => (a.id === id ? next : a)));

  const fileInput = useRef(null);

  /* Read a plain results workbook and set each level's CV to the pooled
     within-lot CV of the worst-performing instrument. Columns expected
     (case-insensitive, any order): analyte, level, lot, instrument,
     result. Instrument and lot may be blank. Targets and TEa are not
     read from the file; the user keeps those. */
  const importResults = async (file) => {
    try {
      setStatus("Reading results…");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
      if (!rows.length) {
        setStatus("No rows found in file.");
        return;
      }
      const key = (obj, ...names) => {
        const keys = Object.keys(obj);
        for (const n of names) {
          const hit = keys.find((k) => k.trim().toLowerCase() === n);
          if (hit) return hit;
        }
        return null;
      };
      const first = rows[0];
      const kA = key(first, "analyte", "analytt", "analyt", "test");
      const kL = key(first, "level", "nivå", "niva", "nivaa", "control");
      const kR = key(first, "result", "verdi", "value", "resultat");
      const kLot = key(first, "lot", "lotnr", "lot number", "control lot");
      const kIns = key(first, "instrument", "analyser", "analyzer", "device", "instrument id");
      // Rows the LIS rejected are left out of the imprecision estimate.
      const kRev = key(first, "review");
      const kRej = key(first, "lis_rejected");
      let skipped = 0;
      if (!kA || !kL || !kR) {
        setStatus("File needs analyte, level and result columns.");
        return;
      }
      const num = (v) => {
        if (typeof v === "number") return v;
        const m = String(v).replace(",", ".").match(/-?\d+(\.\d+)?/);
        return m ? parseFloat(m[0]) : NaN;
      };
      const normLevel = (v) => {
        const s = String(v).trim().toUpperCase().replace(/\s+/g, "");
        if (/^L\d$/.test(s)) return s;
        return s; // other labels are ranked by their mean below
      };
      // group values by analyte -> level -> instrument -> lot
      const tree = {};
      for (const r of rows) {
        const a = String(r[kA]).trim();
        const lv = normLevel(r[kL]);
        const val = num(r[kR]);
        if (!a || !lv || !isFinite(val)) continue;
        if (
          (kRev && String(r[kRev]).trim().toLowerCase() === "rejected") ||
          (kRej && String(r[kRej]).trim() === "1")
        ) {
          skipped++;
          continue;
        }
        const ins = kIns ? String(r[kIns]).trim() || "—" : "—";
        const lot = kLot ? String(r[kLot]).trim() || "—" : "—";
        (((tree[a] ??= {})[lv] ??= {})[ins] ??= {})[lot] ??= [];
        tree[a][lv][ins][lot].push(val);
      }
      // Level labels that are not L1, L2, … (for example "ClinChem 2" and
      // "ClinChem 3") are renumbered by ascending mean: lowest becomes L1.
      for (const [a, lvls] of Object.entries(tree)) {
        const labels = Object.keys(lvls);
        const plain = labels.every((l) => /^L\d$/.test(l));
        if (plain) continue;
        const meanOf = (l) => {
          let s = 0, c = 0;
          for (const lots of Object.values(lvls[l]))
            for (const vs of Object.values(lots)) for (const v of vs) { s += v; c++; }
          return c ? s / c : Infinity;
        };
        const ranked = labels.sort((x, y) => meanOf(x) - meanOf(y));
        const next = {};
        ranked.forEach((l, i) => (next[`L${i + 1}`] = lvls[l]));
        tree[a] = next;
      }
      // pooled within-lot CV for one instrument's set of lots
      const pooledCv = (lots) => {
        let num0 = 0,
          den = 0,
          wsum = 0,
          nsum = 0;
        for (const vs of Object.values(lots)) {
          if (vs.length < 2) continue;
          const m = vs.reduce((s, x) => s + x, 0) / vs.length;
          const v = vs.reduce((s, x) => s + (x - m) ** 2, 0) / (vs.length - 1);
          num0 += (vs.length - 1) * v;
          den += vs.length - 1;
          wsum += vs.length * m;
          nsum += vs.length;
        }
        if (den <= 0 || nsum === 0) return null;
        const psd = Math.sqrt(num0 / den);
        const gm = wsum / nsum;
        return { cv: gm > 0 ? (100 * psd) / gm : NaN, n: nsum };
      };
      // for each analyte-level, pick the worst (highest CV) instrument,
      // and derive the target from the pooled mean of all analysers
      const cvOf = {}; // analyte -> level -> {cv,n,instrument,target,maxDev}
      const report = [];
      for (const [a, lvls] of Object.entries(tree)) {
        cvOf[a] = {};
        for (const [lv, inss] of Object.entries(lvls)) {
          let worst = null;
          const insMean = {};
          let grandSum = 0,
            grandN = 0;
          for (const [ins, lots] of Object.entries(inss)) {
            const p = pooledCv(lots);
            if (p && isFinite(p.cv) && (!worst || p.cv > worst.cv))
              worst = { ...p, instrument: ins };
            let s = 0,
              c = 0;
            for (const vs of Object.values(lots)) {
              for (const v of vs) {
                s += v;
                c++;
              }
            }
            if (c) {
              insMean[ins] = s / c;
              grandSum += s;
              grandN += c;
            }
          }
          if (worst) {
            // target = n-weighted mean across all analysers
            const target = grandN ? grandSum / grandN : null;
            // residual deviation of each analyser from that target, in SD units
            let maxDev = 0;
            if (target && isFinite(worst.cv)) {
              const sd = (worst.cv / 100) * target;
              for (const m of Object.values(insMean)) {
                const dv = sd > 0 ? Math.abs(m - target) / sd : 0;
                if (dv > maxDev) maxDev = dv;
              }
            }
            cvOf[a][lv] = { ...worst, target, maxDev };
            report.push(
              `${a} ${lv}: CV ${worst.cv.toFixed(2)}% (n=${worst.n}), target ${
                target != null ? target.toPrecision(4) : "—"
              }, worst analyser offset ${maxDev.toFixed(2)} SD`
            );
          }
        }
      }
      // Apply to matching analytes by name (case-insensitive); analytes not yet
      // in the panel are added with the levels found in the file.
      const applyLevels = (levels, data) =>
        levels.map((l) => {
          const c = data[l.label];
          if (!c || !isFinite(c.cv)) return l;
          const next = { ...l, cv: Number(c.cv.toFixed(3)) };
          if (c.target != null && isFinite(c.target))
            next.target = Number(c.target.toPrecision(6));
          // Worst analyser offset from that pooled target, carried in as a
          // systematic error so its effect on false alarms is visible.
          if (isFinite(c.maxDev)) next.bias = Number((c.maxDev * c.cv).toFixed(3));
          return next;
        });
      const names = Object.keys(cvOf);
      const matchedNames = new Set();
      const updated = analytes.map((an) => {
        const hit = names.find((k) => k.toLowerCase() === an.name.trim().toLowerCase());
        if (!hit) return an;
        matchedNames.add(hit);
        const labels = Object.keys(cvOf[hit]).sort();
        // add levels present in the file but missing from the card
        const have = new Set(an.levels.map((l) => l.label));
        const extra = labels
          .filter((l) => !have.has(l))
          .map((l) => lvl(l, "", "", 1, 3));
        return { ...an, levels: applyLevels([...an.levels, ...extra], cvOf[hit]) };
      });
      const added = names.filter((n) => !matchedNames.has(n));
      const fresh = added.map((n) => ({
        id: uid(),
        panel: "Imported",
        name: n,
        pedReq: null,
        unit: "",
        tea: "",
        teaSource: "Custom",
        teaOptions: [],
        bv: {},
        levels: applyLevels(
          Object.keys(cvOf[n]).sort().map((l) => lvl(l, "", "", 1, 3)),
          cvOf[n]
        ),
        note: "",
      }));
      setAnalytes([...updated, ...fresh]);
      setStatus("Imported");
      setImportNote(
        `Imported ${names.length} analyte${names.length === 1 ? "" : "s"}: ${matchedNames.size} updated, ${added.length} added` +
          (skipped ? `, ${skipped} LIS-rejected result${skipped === 1 ? "" : "s"} left out` : "")
      );
    } catch (e) {
      setStatus("Could not read that file — check it is a .xlsx or .csv with analyte, level and result columns.");
    }
  };

  const addAnalyte = () =>
    setAnalytes((prev) => [
      ...prev,
      {
        id: uid(),
        panel: "Clinical chemistry",
        name: "New analyte",
        pedReq: null,
        unit: "",
        tea: "",
        teaSource: "Custom",
        teaOptions: [],
        bv: {},
        levels: [lvl("L1", "", "", 1, 3), lvl("L2", "", "", 1, 3)],
        note: "",
      },
    ]);

  const exportCsv = () => {
    const rows = [
      [
        "Panel",
        "Analyte",
        "TEa %",
        "TEa source",
        "Level",
        "Target",
        "CV %",
        "Bias / offset %",
        "Controls",
        "K",
        "TEa in SD",
        "Sigma",
        "Sigma band",
        "Critical shift",
        "False alarm %",
        "Detection",
        "Action limit",
        "Lower",
        "Upper",
        "SD for LIS",
        "Maker range",
        "Maker K",
        "Maker detection",
        "Maker false alarm %",
        "Combined false alarm %",
        "Combined detection",
        "Note",
      ],
    ];
    computed.forEach((a) => {
      a.levels.forEach((l, i) => {
        rows.push([
          i === 0 ? a.panel || "" : "",
          i === 0 ? a.name : "",
          i === 0 ? (isFinite(effectiveTea(a)) ? effectiveTea(a) : "") : "",
          i === 0 ? a.teaSource : "",
          l.label,
          l.target,
          l.cv,
          l.bias,
          l.n,
          l.k,
          fmt(l.teaAsSd),
          fmt(l.sigma),
          sigmaBand(l.sigma)?.label ?? "",
          fmt(l.criticalShift),
          fmt(l.pfr * 100, 3),
          fmt(l.ped, 3),
          fmt(l.actionLimit, 4),
          fmt(l.lower, 4),
          fmt(l.upper, 4),
          fmt(l.sdForLis, 4),
          l.hasMfr ? l.mfrRange : "",
          l.hasMfr ? fmt(l.mfrK, 2) : "",
          l.hasMfr ? fmt(l.mfrPed, 3) : "",
          l.hasMfr ? fmt(l.mfrPfr * 100, 3) : "",
          i === 0 ? fmt(a.combinedPfr * 100, 3) : "",
          i === 0 ? fmt(a.combinedPed, 3) : "",
          i === 0 ? (a.note || "").replace(/"/g, "'") : "",
        ]);
      });
    });
    const csv = rows
      .map((r) => r.map((c) => `"${String(c)}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "iqc-control-rules-clinchem.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const resetAll = () => {
    setAnalytes(DEFAULT_ANALYTES);
    setSettings(DEFAULT_SETTINGS);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-7xl px-5 py-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Internal quality control for clinical chemistry and immunochemistry
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
            Control rules built from the imprecision your own instruments produce,
            rather than from a fixed range someone else measured. Enter your figures,
            see what each rule would catch and what it would cost in needless
            rejections, and read off the standard deviation to put into your
            laboratory system.
          </p>
        </header>

        <nav className="mb-6 flex gap-6 border-b border-slate-300">
          {[
            ["design", "Rule design"],
            ["compare", "Maker ranges"],
            ["method", "Method and references"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-1 pb-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                tab === id
                  ? "border-teal-700 font-medium text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        {tab === "compare" && (
          <ComparisonView computed={computed} settings={settings} />
        )}

        {tab === "method" && <MethodGuide settings={settings} />}

        {tab === "design" && (
          <>
        <div className="mb-6 flex flex-wrap items-end gap-x-8 gap-y-4 border border-slate-300 bg-white px-4 py-4">
          <label className="text-sm text-slate-600">
            <span className="mb-1 block">False alarm allowance</span>
            <span className="flex items-center gap-1.5">
              <NumberCell
                value={settings.pfrBudget}
                onChange={(v) => setSettings({ ...settings, pfrBudget: Number(v) })}
                width="w-16"
                step="0.1"
              />
              <span className="font-mono text-slate-500">%</span>
            </span>
          </label>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block">Detection target</span>
            <span className="flex items-center gap-1.5">
              <NumberCell
                value={settings.pedTarget}
                onChange={(v) => setSettings({ ...settings, pedTarget: Number(v) })}
                width="w-16"
                step="1"
              />
              <span className="font-mono text-slate-500">%</span>
            </span>
          </label>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block">Safety margin (z)</span>
            <NumberCell
              value={settings.zAlpha}
              onChange={(v) => setSettings({ ...settings, zAlpha: Number(v) })}
              width="w-16"
              step="0.05"
            />
          </label>
          <label className="text-sm text-slate-600">
            <span className="mb-1 block">LIS rule width (SD)</span>
            <NumberCell
              value={settings.qmMultiplier}
              onChange={(v) =>
                setSettings({ ...settings, qmMultiplier: Number(v) || 3 })
              }
              width="w-16"
              step="0.5"
            />
          </label>

          <div className="ml-auto flex items-center gap-3">
            <span className="font-mono text-xs text-slate-500">{status}</span>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) importResults(f);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              title="Load a results file (columns: analyte, level, lot, instrument, result) and set each CV to the pooled within-lot value of the worst instrument"
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              Import results
            </button>
            <button
              onClick={exportCsv}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              Export CSV
            </button>
            <button
              onClick={resetAll}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
        </div>

        {importNote && (
          <p className="mb-6 flex items-start justify-between gap-4 border-l-2 border-teal-600 bg-white px-4 py-3 text-sm text-slate-700">
            <span>{importNote}</span>
            <button
              type="button"
              onClick={() => setImportNote("")}
              className="text-slate-400 hover:text-slate-700"
              title="Dismiss"
            >
              ×
            </button>
          </p>
        )}

        {failing.length > 0 && (
          <p className="mb-6 border-l-2 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {failing.length === 1
              ? `${failing[0].name} is outside your limits.`
              : `${failing.length} analytes are outside your limits: ${failing
                  .map((a) => a.name)
                  .join(", ")}.`}{" "}
            A level whose critical shift is at or below zero cannot be fixed by
            changing the rule — the imprecision is too large for the allowable error.
          </p>
        )}

        {incomplete.length > 0 && (
          <p className="mb-6 border-l-2 border-slate-300 bg-white px-4 py-3 text-sm text-slate-600">
            {incomplete.length} of {computed.length} analytes are not yet judged
            because an allowable error or a CV is missing. Enter the allowable error
            sources on each card; load control results with Import results to fill
            the CV, target and analyser offset.
          </p>
        )}

        <div className="space-y-5">
          {panels.map((panel) => {
            const group = computed.filter((a) => (a.panel || "Imported") === panel);
            if (!group.length) return null;
            return (
              <div key={panel} className="space-y-5">
                <h2 className="pt-2 text-sm font-semibold text-slate-500">
                  {panel}
                </h2>
                {group.map((a) => (
                  <AnalytePanel
                    key={a.id}
                    analyte={a}
                    settings={settings}
                    onChange={(next) =>
                      updateAnalyte(a.id, {
                        ...next,
                        levels: next.levels.map(
                          ({
                            teaAsSd,
                            sigma,
                            criticalShift,
                            pfr,
                            ped,
                            actionLimit,
                            sdForLis,
                            cvForLis,
                            mfrK,
                            mfrPfr,
                            mfrPed,
                            hasMfr,
                            lower,
                            upper,
                            ...rest
                          }) => rest
                        ),
                      })
                    }
                    onRemove={() =>
                      setAnalytes((prev) => prev.filter((x) => x.id !== a.id))
                    }
                  />
                ))}
              </div>
            );
          })}
        </div>

        <button
          onClick={addAnalyte}
          className="mt-5 w-full border border-dashed border-slate-300 bg-white py-3 text-sm text-slate-600 hover:border-teal-600 hover:text-teal-800"
        >
          Add analyte
        </button>
          </>
        )}

        <footer className="mt-10 border-t border-slate-200 pt-5 text-xs leading-relaxed text-slate-500">
          <p className="max-w-3xl">
            Work is saved in your browser as you type, on this device only. Export the
            CSV if you need a copy that lasts. Rule choices still need authorisation
            before anyone enters them into the analyser.
          </p>
        </footer>
      </div>
    </div>
  );
}
