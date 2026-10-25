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
import {
  LN_GAMMA_HALF,
  gserHalf,
  gcfHalf,
  erfc,
  SQRT2,
  normSf,
  normCdf,
  insideProb,
  falseRejection,
  errorDetection,
  combine,
  shiftForDetection,
  BV_TIERS,
  bvTea,
  teaOptionsFor,
  sigmaBand,
  TONE,
  uid,
  lvl,
  PANELS,
  ccAnalyte,
  DEFAULT_ANALYTES,
  TEST_CODES,
  SOURCE_SUGGESTIONS,
  DEFAULT_SETTINGS,
  criticalErrorPct,
  criticalShiftFor,
  computeLevel,
  effectiveTea,
  missingInputs,
  computeAnalyte,
  K_GRID,
  searchRules,
  combinedPedAtCv,
  maxCvForLevel,
  cvForSigma,
  cusumArl,
  cusumArl0,
  shewhartArl,
  runCusum,
  makeRng,
  ewmaLimit,
  ewmaArl,
  runEwma,
  multiruleReject,
  multirulePfr,
  multirulePed,
  binseg,
  RULE_SETS,
} from "./core.js";
import { VERIFICATION } from "./verification_data.js";

const fmt = (v, d = 2) =>
  !isFinite(v) ? "—" : v.toFixed(d);
const pct = (v, d = 2) => (!isFinite(v) ? "—" : (v * 100).toFixed(d) + "%");

/* "target ± SD" in the measurand's unit, decimals chosen from the target's size. */
function lisEntry(l) {
  const d = sigDigits(Number(l.target));
  return `${fmt(Number(l.target), d)} ± ${fmt(l.sdForLis, d + 1)}`;
}

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
  // Two views of the same thing. In SD units each level has its own curve and
  // its own critical shift. In per cent a systematic error is one number for
  // the measurand: it is a different number of SD at each level (CV differs),
  // so the per-level curves separate and the combined curve, 1 − Π(1 − p),
  // is the probability that at least one level flags that error.
  const [unit, setUnit] = useState("pct");
  const tea = effectiveTea(analyte);
  const maxPct = isFinite(tea) ? Math.max(tea * 1.3, 1) : 10;
  const data = useMemo(() => {
    const points = [];
    const steps = 50;
    for (let i = 0; i <= steps; i++) {
      const x = unit === "sd" ? (i / steps) * 6 : (i / steps) * maxPct;
      const row = { x: Number(x.toFixed(3)) };
      let miss = 1;
      analyte.levels.forEach((l) => {
        const cv = Number(l.cv);
        const shiftSd = unit === "sd" ? x : cv > 0 ? Math.max(0, x - Math.abs(Number(l.bias) || 0)) / cv : 0;
        const p = errorDetection(Number(l.k), l.n, shiftSd);
        row[l.label] = p;
        miss *= 1 - p;
      });
      row.Combined = 1 - miss;
      points.push(row);
    }
    return points;
  }, [analyte, settings, unit, maxPct]);

  const colors = ["#0f766e", "#0891b2", "#7c3aed", "#b45309"];
  const critPct = isFinite(analyte.critPct) ? analyte.critPct : isFinite(tea) ? tea - Math.max(...analyte.levels.map((l) => Math.abs(Number(l.bias) || 0) + settings.zAlpha * (Number(l.cv) || 0))) : NaN;

  return (
    <div className="mt-4 border-t border-slate-200 pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="max-w-2xl text-sm text-slate-600">
          Detection probability against the size of a systematic error, per level and
          combined over the levels (at least one level rejects). Dashed marks: each
          level's critical shift; in per cent the critical error of the measurand.
        </p>
        <select value={unit} onChange={(e) => setUnit(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-teal-600 focus:outline-none">
          <option value="pct">Error in % of the result</option>
          <option value="sd">Shift in SD of each level</option>
        </select>
      </div>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 5, right: 16, bottom: 24, left: 4 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 3" />
            <XAxis dataKey="x" type="number" domain={[0, unit === "sd" ? 6 : Number(maxPct.toFixed(2))]} tickFormatter={(v) => (unit === "sd" ? v.toFixed(1) : v.toFixed(1))} tick={{ fontSize: 11, fill: "#475569" }} stroke="#94a3b8"
              label={{ value: unit === "sd" ? "Systematic shift (SD)" : "Systematic error (%)", position: "insideBottom", offset: -12, fontSize: 11, fill: "#475569" }} />
            <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#475569" }} stroke="#94a3b8" tickFormatter={(v) => v.toFixed(1)} />
            <Tooltip formatter={(v) => v.toFixed(3)} labelFormatter={(v) => (unit === "sd" ? `Shift ${v} SD` : `Error ${v}%`)} contentStyle={{ fontSize: 12, borderRadius: 4 }} />
            <Legend verticalAlign="top" align="right" height={22} wrapperStyle={{ fontSize: 12 }} />
            {analyte.levels.map((l, i) => (
              <Line key={l.id} type="monotone" dataKey={l.label} stroke={colors[i % colors.length]} dot={false} strokeWidth={1.5} />
            ))}
            <Line type="monotone" dataKey="Combined" stroke="#0f172a" dot={false} strokeWidth={2.5} />
            {unit === "sd"
              ? analyte.levels.map((l, i) => (l.criticalShift > 0 ? <ReferenceLine key={`ref-${l.id}`} x={Number(l.criticalShift.toFixed(2))} stroke={colors[i % colors.length]} strokeDasharray="4 3" /> : null))
              : isFinite(critPct) && critPct > 0 ? <ReferenceLine x={Number(critPct.toFixed(2))} stroke="#0f172a" strokeDasharray="4 3" label={{ value: "critical error", fontSize: 10, fill: "#475569", position: "top" }} /> : null}
            {unit === "pct" && isFinite(tea) ? <ReferenceLine x={Number(tea.toFixed(2))} stroke="#b91c1c" strokeDasharray="2 3" label={{ value: "TEa", fontSize: 10, fill: "#b91c1c", position: "top" }} /> : null}
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

function AnalytePanel({ analyte, settings, onChange, onRemove, series }) {
  const [chart, setChart] = useState("power");
  const [view, setView] = useState("rule");
  const [strategy, setStrategy] = useState("balanced");
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
    <section className="rounded-md border border-slate-200 bg-white shadow-sm">
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
          {(() => {
            const cvi = Number(analyte.bv && analyte.bv.cvi);
            const cvs = analyte.levels.map((l) => Number(l.cv)).filter((c) => c > 0);
            if (!(cvi > 0) || !cvs.length) return null;
            const soc = cvi / Math.max(...cvs);
            return (
              <span
                className={`rounded px-2 py-0.5 font-mono text-xs ${soc >= 4.65 ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}
                title={`Oosterhuis–Coskun sigma: CVI / CV, no coverage factor, bias set aside. CVI ${cvi}% / worst CV ${fmt(Math.max(...cvs), 2)}%. Their benchmark is 4.65 (CV ≤ 0.22·CVI, here ≤ ${fmt(0.22 * cvi, 2)}%). Reported for comparison; not used for rule design.`}
              >
                σ<sub>CVI/CV</sub> {fmt(soc, 2)}
              </span>
            );
          })()}
          {analyte.ready ? (
            <>
              {analyte.anyOffset && (
                <Verdict ok={analyte.pfrOffsetOk}>
                  False alarms with offset {fmt(analyte.combinedPfrOffset * 100, 2)}%
                </Verdict>
              )}
            </>
          ) : (
            <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
              Needs {analyte.missing.join(", ")}
            </span>
          )}
        </div>
      </header>

      <ResultStrip analyte={analyte} settings={settings} />

      <nav className="flex gap-5 border-b border-slate-200 px-4" aria-label="Analyte sections">
        {[["rule", "Rule"], ["sources", "Allowable error sources"], ["lis", "LIS and limits"], ["monitor", "Monitoring"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setView(id)}
            className={`-mb-px border-b-2 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${view === id ? "border-teal-700 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
          </button>
        ))}
      </nav>

      <div className="px-4 py-4">
        {view === "rule" && (<>
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

        </>)}

        {view === "sources" && (<>
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

        </>)}

        {view === "rule" && (<>
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

        </>)}

        {view === "lis" && (<>
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

        <div className="mt-4 border border-slate-200 bg-white px-3 py-2.5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
            What to enter in the LIS — now and recommended
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 text-right font-medium">Target now</th>
                <th className="py-1 pr-3 text-right font-medium">SD now</th>
                <th className="py-1 pr-3 text-right font-medium">Rule now (K)</th>
                <th className="py-1 pr-3 text-right font-medium">False alarm now</th>
                <th className="py-1 pr-3 text-right font-medium">Detection now</th>
                <th className="py-1 pr-3 text-right font-medium">Target recommended</th>
                <th className="py-1 pr-3 text-right font-medium">SD recommended</th>
                <th className="py-1 pr-3 text-right font-medium">SD change</th>
                <th className="py-1 pr-3 text-right font-medium">Target shift (SD)</th>
              </tr>
            </thead>
            <tbody>
              {analyte.levels.map((l) => {
                const d = sigDigits(l.target);
                return (
                  <tr key={l.id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 font-mono text-slate-700">{l.label}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <NumberCell value={l.lisTarget ?? ""} onChange={(v) => setLevel(l.id, { lisTarget: v })} width="w-24" />
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <NumberCell value={l.lisSd ?? ""} onChange={(v) => setLevel(l.id, { lisSd: v })} width="w-24" />
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-slate-600">{l.hasLis ? fmt(l.lisK, 2) : "\u2014"}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${l.hasLis && l.lisPfr > l.pfr * 2 ? "text-rose-700" : "text-slate-600"}`}>{l.hasLis ? `${fmt(l.lisPfr * 100, 2)}%` : "\u2014"}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${l.hasLis && l.lisPed < l.ped ? "text-rose-700" : "text-slate-600"}`}>{l.hasLis ? fmt(l.lisPed, 3) : "\u2014"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono font-semibold text-slate-900">{analyte.ready ? fmt(l.target, d) : "\u2014"}</td>
                    <td className="py-1.5 pr-3 text-right font-mono font-semibold text-slate-900">{analyte.ready ? fmt(l.sdForLis, d + 1) : "\u2014"}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${l.hasLis && Math.abs(l.lisSdChange) >= 20 ? "text-amber-800" : "text-slate-600"}`}>{l.hasLis && analyte.ready ? `${l.lisSdChange > 0 ? "+" : ""}${fmt(l.lisSdChange, 0)}%` : "\u2014"}</td>
                    <td className={`py-1.5 pr-3 text-right font-mono ${l.hasLis && Math.abs(l.lisOffsetSd) >= 1 ? "text-amber-800" : "text-slate-600"}`}>{l.hasLis ? fmt(-l.lisOffsetSd, 2) : "\u2014"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            &ldquo;Now&rdquo; is the target and SD currently entered in the LIS (read from a cobas
            infinity export, or typed here); its rule is taken as 1:3s on that SD and expressed in the
            measured SD. &ldquo;Recommended&rdquo; is the pooled lot mean as target and the action
            limit ÷ {settings.qmMultiplier} as SD, so that the same 1:3s rule reproduces the derived
            limit. Target shift is how far the recommended target moves from the current one, in measured SD.
            {analyte.hasLis && analyte.ready && (
              <>
                {" "}With the current entries the combined false alarm is {fmt(analyte.combinedLisPfr * 100, 2)}% and
                detection {fmt(analyte.combinedLisPed * 100, 1)}%; with the recommended entries{" "}
                {fmt(analyte.combinedPfr * 100, 2)}% and {fmt(analyte.combinedPed * 100, 1)}%.
              </>
            )}
          </p>
        </div>

        </>)}

        {view === "monitor" && (<>
        <CusumPanel analyte={analyte} settings={settings} series={series} />
        <ModelsPanel analyte={analyte} settings={settings} series={series} />
        </>)}

        {view === "rule" && (<>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <select
            value={strategy}
            onChange={(e) => {
              setStrategy(e.target.value);
              setSuggestion(null);
            }}
            className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
          >
            <option value="balanced">Best combined detection</option>
            <option value="ends">Favour lowest and highest level</option>
            <option value="l1">Favour lowest level</option>
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
        </>)}
      </div>
    </section>
  );
}

/* The answer first: adopted source, rule, what it costs and catches, and what to
   enter in the LIS. Always visible above the tabs. */
function ResultStrip({ analyte, settings }) {
  if (!analyte.ready) {
    return (
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-600">
        Enter {analyte.missing.join(", ")} to derive a rule. Use the Allowable error sources tab for the limit and Import results (top) for CV and target.
      </div>
    );
  }
  const cell = (label, value, title) => (
    <div className="min-w-[7rem]" title={title}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-sm text-slate-900">{value}</div>
    </div>
  );
  const req = analyte.pedReq ?? settings.pedTarget;
  return (
    <div className="flex flex-wrap items-start gap-x-7 gap-y-3 border-b border-teal-100 bg-teal-50/60 px-4 py-3">
      {cell("Allowable error", `${analyte.teaSource} · ${fmt(effectiveTea(analyte), 1)}%`, "Adopted source and limit")}
      {cell("Rule (K per level)", analyte.levels.map((l) => fmt(l.k, 1)).join(" / "), "Rejection limit in observed SD, one control per level")}
      {cell("Sigma", analyte.levels.map((l) => fmt(l.sigma, 1)).join(" / "), "(TEa − |offset|) / CV per level")}
      {isFinite(analyte.critPct) && cell("Critical error", `${fmt(analyte.critPct, 2)}%`, "One size for the measurand: TEa − max over levels of (|offset| + z·CV); converted to SD at each level with its own CV")}
      {cell("False rejection", `${fmt(analyte.combinedPfr * 100, 2)}% of ${settings.pfrBudget}%`, "Combined over levels per control event")}
      {cell("Detection", `${fmt(analyte.combinedPed * 100, 1)}% (req. ${req}%)`, "Combined probability of detecting the critical error")}
      {cell("LIS target / SD to enter", analyte.levels.map(lisEntry).join("  ·  "), `Target = lot mean; SD = action limit / ${settings.qmMultiplier} so that the LIS ${settings.qmMultiplier} SD rule reproduces the derived limit`)}
      {analyte.hasLis && cell("LIS rule now", `detects ${fmt(analyte.combinedLisPed * 100, 0)}%`, "Detection of the critical error by the target and SD currently in the LIS")}
    </div>
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


function CusumPanel({ analyte, settings, series }) {
  const [k, setK] = useState(settings.cusumK ?? 0.5);
  const [h, setH] = useState(settings.cusumH ?? 5);
  const [centre, setCentre] = useState("lot"); // "lot" | "analyser" | "target"
  const [pick, setPick] = useState("");
  const kk = Number(k) > 0 ? Number(k) : 0.5;
  const hh = Number(h) > 0 ? Number(h) : 5;
  const shifts = [0.5, 1, 1.5, 2, 3];

  // Design comparison, no data needed
  const design = analyte.levels.map((l) => ({
    label: l.label,
    k: Number(l.k),
    n: Math.max(1, Math.round(Number(l.n) || 1)),
  }));

  // Data: series[level][instrument][lot] = [{t, v}]
  const runs = useMemo(() => {
    if (!series) return [];
    const out = [];
    for (const l of analyte.levels) {
      const byIns = series[l.label];
      if (!byIns) continue;
      const cv = Number(l.cv);
      if (!(cv > 0)) continue;
      // lot means over all analysers, and per analyser
      const lotAll = {};
      const lotIns = {};
      for (const [ins, lots] of Object.entries(byIns))
        for (const [lot, pts] of Object.entries(lots)) {
          const m = pts.reduce((a, p) => a + p.v, 0) / pts.length;
          (lotAll[lot] ??= { s: 0, n: 0 });
          lotAll[lot].s += m * pts.length; lotAll[lot].n += pts.length;
          lotIns[`${ins}|${lot}`] = m;
        }
      for (const [ins, lots] of Object.entries(byIns)) {
        // one chart per analyser, lots in time order, CUSUM reset at a lot change
        const lotNames = Object.keys(lots).sort((a, b) => (lots[a][0]?.t ?? 0) - (lots[b][0]?.t ?? 0));
        let path = [], alarms = [], n = 0, offset = 0;
        for (const lot of lotNames) {
          const pts = lots[lot];
          const c =
            centre === "analyser" ? lotIns[`${ins}|${lot}`]
            : centre === "target" && Number(l.target) > 0 ? Number(l.target)
            : lotAll[lot].s / lotAll[lot].n;
          const sd = (cv / 100) * c;
          const z = pts.map((p) => (p.v - c) / sd);
          const r = runCusum(z, kk, hh);
          path = path.concat(r.path.map((q) => ({ ...q, i: q.i + offset, t: pts[q.i].t, lot })));
          alarms = alarms.concat(r.alarms.map((a) => ({ ...a, i: a.i + offset, t: pts[a.i].t, lot })));
          offset += pts.length; n += pts.length;
        }
        out.push({ level: l.label, instrument: ins, n, alarms, path,
          per1000: n ? (1000 * alarms.length) / n : NaN,
          medianRun: alarms.length ? [...alarms.map((a) => a.run)].sort((a, b) => a - b)[Math.floor(alarms.length / 2)] : NaN });
      }
    }
    return out;
  }, [series, analyte.levels, kk, hh, centre]);

  const keys = runs.map((r) => `${r.level} · ${r.instrument}`);
  const sel = runs.find((r) => `${r.level} · ${r.instrument}` === pick) || runs[0];
  const fmtDate = (t) => (t ? new Date(t).toISOString().slice(0, 10) : "");

  return (
    <div className="mt-4 border border-slate-200 bg-white px-3 py-2.5">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">CUSUM</p>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          k (SD) <NumberCell value={k} onChange={setK} width="w-16" step="0.1" />
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600">
          h (SD) <NumberCell value={h} onChange={setH} width="w-16" step="0.5" />
        </label>
        <span className="font-mono text-xs text-slate-600">
          ARL₀ {fmt(cusumArl0(kk, hh), 0)} · ARL at 1 SD {fmt(cusumArl(1, kk, hh), 1)}
        </span>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="py-1 pr-3 font-medium">Average run length to alarm</th>
            <th className="py-1 pr-3 text-right font-medium">In control</th>
            {shifts.map((d) => (
              <th key={d} className="py-1 pr-3 text-right font-medium">{d} SD</th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-slate-100">
            <td className="py-1.5 pr-3 text-slate-700">CUSUM k {kk}, h {hh}</td>
            <td className="py-1.5 pr-3 text-right font-mono text-slate-700">{fmt(cusumArl0(kk, hh), 0)}</td>
            {shifts.map((d) => (
              <td key={d} className="py-1.5 pr-3 text-right font-mono text-slate-700">{fmt(cusumArl(d, kk, hh), 1)}</td>
            ))}
          </tr>
          {design.map((d) => (
            <tr key={d.label} className="border-t border-slate-100">
              <td className="py-1.5 pr-3 text-slate-700">{d.label}: 1:{fmt(d.k, 1)} rule, n {d.n}</td>
              <td className="py-1.5 pr-3 text-right font-mono text-slate-700">{fmt(shewhartArl(d.k, d.n, 0), 0)}</td>
              {shifts.map((s) => (
                <td key={s} className="py-1.5 pr-3 text-right font-mono text-slate-700">{fmt(shewhartArl(d.k, d.n, s), 1)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs leading-relaxed text-slate-600">
        Average number of control results until an alarm when the process is in control and after a
        sustained shift. The 1:K rule reacts to single results; the CUSUM accumulates small departures
        and catches a persistent 0.5–1 SD shift several times sooner at a lower in-control alarm rate.
        Siegmund's approximation, two-sided.
      </p>

      {runs.length > 0 ? (
        <div className="mt-3">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            <select value={centre} onChange={(e) => setCentre(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-teal-600 focus:outline-none">
              <option value="lot">Centre: pooled lot mean</option>
              <option value="analyser">Centre: analyser lot mean</option>
              <option value="target">Centre: card target</option>
            </select>
            <select value={pick || keys[0]} onChange={(e) => setPick(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-teal-600 focus:outline-none">
              {keys.map((kx) => (<option key={kx} value={kx}>{kx}</option>))}
            </select>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="py-1 pr-3 font-medium">Level · analyser</th>
                <th className="py-1 pr-3 text-right font-medium">n</th>
                <th className="py-1 pr-3 text-right font-medium">Alarms</th>
                <th className="py-1 pr-3 text-right font-medium">per 1000</th>
                <th className="py-1 pr-3 text-right font-medium">Median run</th>
                <th className="py-1 pr-3 text-right font-medium">Expected per 1000</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={`${r.level}${r.instrument}`} className="border-t border-slate-100">
                  <td className="py-1 pr-3 font-mono text-slate-700">{r.level} · {r.instrument}</td>
                  <td className="py-1 pr-3 text-right font-mono text-slate-600">{r.n}</td>
                  <td className="py-1 pr-3 text-right font-mono text-slate-600">{r.alarms.length}</td>
                  <td className={`py-1 pr-3 text-right font-mono ${r.per1000 > 5 * (1000 / cusumArl0(kk, hh)) ? "text-rose-700" : "text-slate-600"}`}>{fmt(r.per1000, 1)}</td>
                  <td className="py-1 pr-3 text-right font-mono text-slate-600">{isFinite(r.medianRun) ? r.medianRun : "—"}</td>
                  <td className="py-1 pr-3 text-right font-mono text-slate-400">{fmt(1000 / cusumArl0(kk, hh), 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sel && (
            <div className="mt-3 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sel.path} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 4" />
                  <XAxis dataKey="i" tick={{ fontSize: 10 }} tickFormatter={(i) => fmtDate(sel.path[i]?.t)} minTickGap={40} />
                  <YAxis tick={{ fontSize: 10 }} domain={[-hh * 1.4, hh * 1.4]} />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    labelFormatter={(i) => `${fmtDate(sel.path[i]?.t)} · lot ${sel.path[i]?.lot ?? ""}`}
                    formatter={(v, name) => [fmt(v, 2), name === "cp" ? "C⁺" : name === "cn" ? "−C⁻" : "z"]}
                  />
                  <ReferenceLine y={hh} stroke="#b91c1c" strokeDasharray="4 4" />
                  <ReferenceLine y={-hh} stroke="#b91c1c" strokeDasharray="4 4" />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Line type="monotone" dataKey="cp" stroke="#0f766e" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  <Line type="monotone" dataKey="cn" stroke="#1d4ed8" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                  {sel.alarms.map((a) => (
                    <ReferenceDot key={a.i} x={a.i} y={a.sign > 0 ? hh : -hh} r={3} fill="#b91c1c" stroke="none" />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            One chart per analyser; the sums restart at each control-lot change and after each alarm.
            Results are standardised with the level's CV and the chosen centre. An alarm rate well above
            the expected in-control rate means the process sits persistently away from the centre, which
            the single-result rule does not show. Imported results are kept for this session only.
          </p>
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-500">
          Import results (with a date column) to run the CUSUM on the data; the comparison above needs no data.
        </p>
      )}
    </div>
  );
}
function ModelsPanel({ analyte, settings, series }) {
  const [open, setOpen] = useState(false);
  const [lam, setLam] = useState(0.2);
  const [L, setL] = useState(2.86);
  const [eqaBias, setEqaBias] = useState("");
  const [uRef, setURef] = useState("");
  const [pickEw, setPickEw] = useState("");
  const lamN = Number(lam) > 0 && Number(lam) <= 1 ? Number(lam) : 0.2;
  const LN = Number(L) > 0 ? Number(L) : 2.86;
  const ready = analyte.ready;
  const dd = (v) => sigDigits(v);
  const fmtDate = (t) => (t > 1e11 ? new Date(t).toISOString().slice(0, 10) : String(t));

  // --- EWMA design (only when the block is open: Monte Carlo)
  const ewDesign = useMemo(() => {
    if (!open) return null;
    return { arl0: ewmaArl(0, lamN, LN), s05: ewmaArl(0.5, lamN, LN), s1: ewmaArl(1, lamN, LN), s2: ewmaArl(2, lamN, LN) };
  }, [open, lamN, LN]);

  // --- multirule at the card's critical shifts
  const shifts = analyte.levels.map((l) => Math.max(0, (l.criticalShift ?? 0)));
  const mr = useMemo(() => {
    if (!open || !ready) return null;
    const nl = analyte.levels.length;
    return RULE_SETS.map(([name, rs]) => {
      const set = new Set(rs);
      const ped = multirulePed(set, shifts);
      return { name, pfr: multirulePfr(set, nl), ped1: ped.first, ped2: ped.two };
    });
  }, [open, ready, shifts.join(","), analyte.levels.length]);

  // --- measurement uncertainty
  const mu = analyte.levels.map((l) => {
    const cv = Number(l.cv); const off = Math.abs(Number(l.bias) || 0);
    const eb = Number(eqaBias); const ur = Number(uRef);
    const ubEqa = isFinite(eb) && eqaBias !== "" ? Math.sqrt(eb * eb + (isFinite(ur) ? ur * ur : 0)) : NaN;
    return { label: l.label, cv, off, uImp: 2 * cv, uOff: 2 * Math.sqrt(cv * cv + off * off), uEqa: isFinite(ubEqa) ? 2 * Math.sqrt(cv * cv + ubEqa * ubEqa) : NaN };
  });

  // --- data-driven: EWMA alarms, reagent-lot steps, control-lot start, variance components, change points
  const data = useMemo(() => {
    if (!open || !series) return null;
    const ew = [], steps = [], lots = [], vc = [], cps = [];
    for (const l of analyte.levels) {
      const byIns = series[l.label]; const cv = Number(l.cv) / 100;
      if (!byIns || !(cv > 0)) continue;
      // lot means over all analysers
      const lotAll = {};
      for (const lotsI of Object.values(byIns)) for (const [lot, pts] of Object.entries(lotsI)) {
        (lotAll[lot] ??= { s: 0, n: 0 }); for (const p of pts) { lotAll[lot].s += p.v; lotAll[lot].n++; }
      }
      const lm = Object.fromEntries(Object.entries(lotAll).map(([k, v]) => [k, v.s / v.n]));
      // control-lot start (all analysers pooled, time order)
      for (const [lot, m] of Object.entries(lm)) {
        const pts = Object.values(byIns).flatMap((li) => li[lot] || []).sort((a, b) => a.t - b.t);
        if (pts.length < 40) continue;
        const first = pts.slice(0, 20).reduce((a, p) => a + p.v, 0) / 20; const sd = cv * m;
        lots.push({ level: l.label, lot, n: pts.length, first, final: m, dev: (first - m) / sd, lisTarget: pts.slice(0, 20).map((p) => p.target).find((v) => v > 0), lisDev: NaN });
        const last = lots[lots.length - 1]; if (last.lisTarget > 0) last.lisDev = (last.lisTarget - m) / sd;
      }
      for (const [ins, lotsI] of Object.entries(byIns)) {
        const lotNames = Object.keys(lotsI).sort((a, b) => (lotsI[a][0]?.t ?? 0) - (lotsI[b][0]?.t ?? 0));
        // series across lots, z relative to the lot mean
        const seq = []; for (const lot of lotNames) for (const p of lotsI[lot]) seq.push({ ...p, lot, z: (p.v - lm[lot]) / (cv * lm[lot]) });
        // EWMA alarms, restart at lot change
        let nAl = 0, path = [], alarms = [], off = 0;
        for (const lot of lotNames) {
          const z = lotsI[lot].map((p) => (p.v - lm[lot]) / (cv * lm[lot]));
          const r = runEwma(z, lamN, LN); nAl += r.alarms.length;
          path = path.concat(r.path.map((q) => ({ ...q, i: q.i + off, t: lotsI[lot][q.i].t, lot })));
          alarms = alarms.concat(r.alarms.map((a) => ({ ...a, i: a.i + off })));
          off += z.length;
        }
        ew.push({ level: l.label, instrument: ins, n: seq.length, alarms: nAl, per1000: seq.length ? (1000 * nAl) / seq.length : NaN, path, alarmList: alarms });
        // reagent-lot transitions (needs r1 in the points)
        if (seq.some((p) => p.r1)) {
          const seenR1 = new Set(seq[0]?.r1 ? [seq[0].r1] : []);
          for (let i = 1; i < seq.length; i++) {
            // a transition is the first appearance of a lot on this analyser; packs
            // alternating on board do not count as repeated transitions
            if (!seq[i].r1) continue;
            if (seenR1.has(seq[i].r1)) continue;
            seenR1.add(seq[i].r1);
            if (!seq[i - 1].r1) continue;
            const before = seq.slice(Math.max(0, i - 30), i), after = seq.slice(i, i + 30);
            if (before.length < 8 || after.length < 8) continue;
            const mb = before.reduce((a, p) => a + p.v, 0) / before.length, ma = after.reduce((a, p) => a + p.v, 0) / after.length;
            const vb = before.reduce((a, p) => a + (p.v - mb) ** 2, 0) / (before.length - 1), va = after.reduce((a, p) => a + (p.v - ma) ** 2, 0) / (after.length - 1);
            const sd = cv * (lm[seq[i].lot] || ma);
            const t = (ma - mb) / Math.sqrt(va / after.length + vb / before.length);
            steps.push({ level: l.label, instrument: ins, t: seq[i].t, oldLot: seq[i - 1].r1, newLot: seq[i].r1, nb: before.length, na: after.length, step: (ma - mb) / sd, p: 2 * normSf(Math.abs(t)) });
          }
        }
        // variance components per control lot, one-way by day
        for (const lot of lotNames) {
          const pts = lotsI[lot]; if (pts.length < 30 || !pts.some((p) => p.t > 1e11)) continue;
          const days = {}; for (const p of pts) (days[Math.floor(p.t / 86400000)] ??= []).push(p.v);
          const k = Object.keys(days).length; const N = pts.length; if (k < 10 || N - k <= 0) continue;
          const gm = pts.reduce((a, p) => a + p.v, 0) / N;
          let ssw = 0, ssb = 0, sumn2 = 0;
          for (const v of Object.values(days)) { const m = v.reduce((a, x) => a + x, 0) / v.length; ssw += v.reduce((a, x) => a + (x - m) ** 2, 0); ssb += v.length * (m - gm) ** 2; sumn2 += v.length ** 2; }
          const msw = ssw / (N - k), msb = ssb / (k - 1), n0 = (N - sumn2 / N) / (k - 1);
          const sb2 = n0 > 0 ? Math.max(0, (msb - msw) / n0) : NaN;
          vc.push({ level: l.label, instrument: ins, lot, n: N, days: k, within: (100 * Math.sqrt(msw)) / gm, between: (100 * Math.sqrt(sb2)) / gm, total: (100 * Math.sqrt(msw + sb2)) / gm });
        }
        // change points
        for (const c of binseg(seq.map((p) => p.z)).sort((a, b) => a.i - b.i)) {
          const q = seq[c.i]; const near = seq.slice(Math.max(0, c.i - 5), c.i + 6).some((p, j, arr) => j > 0 && p.r1 && arr[j - 1].r1 && p.r1 !== arr[j - 1].r1);
          cps.push({ level: l.label, instrument: ins, t: q.t, lot: q.lot, step: c.step, stat: c.stat, nearR1: near });
        }
      }
    }
    return { ew, steps, lots, vc, cps };
  }, [open, series, analyte.levels, lamN, LN]);

  const ewKeys = data ? data.ew.map((r) => `${r.level} · ${r.instrument}`) : [];
  const ewSel = data ? data.ew.find((r) => `${r.level} · ${r.instrument}` === pickEw) || data.ew[0] : null;
  const Th = ({ children, right }) => <th className={`py-1 pr-3 font-medium ${right ? "text-right" : ""}`}>{children}</th>;
  const Td = ({ children, right, cls = "" }) => <td className={`py-1 pr-3 ${right ? "text-right font-mono" : ""} ${cls}`}>{children}</td>;
  const Cap = ({ children }) => <p className="mb-1 mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">{children}</p>;

  return (
    <div className="mt-4 border border-slate-200 bg-white px-3 py-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          More from the same data: EWMA · multirule · measurement uncertainty · lots and steps
        </span>
        <span className="text-xs text-slate-500">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div>
          {/* ---------------- EWMA ---------------- */}
          <Cap>EWMA</Cap>
          <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <label className="flex items-center gap-1">λ <NumberCell value={lam} onChange={setLam} width="w-16" step="0.05" /></label>
            <label className="flex items-center gap-1">L <NumberCell value={L} onChange={setL} width="w-16" step="0.1" /></label>
            {ewDesign && (
              <span className="font-mono">ARL₀ {fmt(ewDesign.arl0, 0)} · at 0.5 SD {fmt(ewDesign.s05, 1)} · 1 SD {fmt(ewDesign.s1, 1)} · 2 SD {fmt(ewDesign.s2, 1)} (Monte Carlo)</span>
            )}
          </div>
          {data && data.ew.length > 0 && (
            <div>
              <div className="mb-1">
                <select value={pickEw || ewKeys[0]} onChange={(e) => setPickEw(e.target.value)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-teal-600 focus:outline-none">
                  {ewKeys.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              </div>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><Th>Level · analyser</Th><Th right>n</Th><Th right>EWMA alarms</Th><Th right>per 1000</Th><Th right>Expected</Th></tr></thead>
                <tbody>{data.ew.map((r) => (
                  <tr key={r.level + r.instrument} className="border-t border-slate-100">
                    <Td cls="font-mono text-slate-700">{r.level} · {r.instrument}</Td><Td right>{r.n}</Td><Td right>{r.alarms}</Td>
                    <Td right cls={ewDesign && r.per1000 > 5 * (1000 / ewDesign.arl0) ? "text-rose-700" : "text-slate-600"}>{fmt(r.per1000, 1)}</Td>
                    <Td right cls="text-slate-400">{ewDesign ? fmt(1000 / ewDesign.arl0, 1) : "—"}</Td>
                  </tr>))}</tbody>
              </table>
              {ewSel && (
                <div className="mt-2 h-48 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={ewSel.path} margin={{ top: 8, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid stroke="#e2e8f0" strokeDasharray="2 4" />
                      <XAxis dataKey="i" tick={{ fontSize: 10 }} tickFormatter={(i) => fmtDate(ewSel.path[i]?.t)} minTickGap={40} />
                      <YAxis tick={{ fontSize: 10 }} domain={[-ewmaLimit(lamN, LN) * 2.2, ewmaLimit(lamN, LN) * 2.2]} />
                      <Tooltip contentStyle={{ fontSize: 11 }} labelFormatter={(i) => `${fmtDate(ewSel.path[i]?.t)} · lot ${ewSel.path[i]?.lot ?? ""}`} formatter={(v) => [fmt(v, 2), "EWMA (SD)"]} />
                      <ReferenceLine y={ewmaLimit(lamN, LN)} stroke="#b91c1c" strokeDasharray="4 4" />
                      <ReferenceLine y={-ewmaLimit(lamN, LN)} stroke="#b91c1c" strokeDasharray="4 4" />
                      <ReferenceLine y={0} stroke="#94a3b8" />
                      <Line type="monotone" dataKey="e" stroke="#0f766e" dot={false} strokeWidth={1.5} isAnimationActive={false} />
                      {ewSel.alarmList.map((a) => <ReferenceDot key={a.i} x={a.i} y={a.sign * ewmaLimit(lamN, LN)} r={3} fill="#b91c1c" stroke="none" />)}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Exponentially weighted moving average of the standardised results; λ 0.2 with L 2.86 gives a few hundred results between
            false alarms and catches a 1 SD shift in about ten. Restarts at each lot change and after each alarm.
          </p>

          {/* ---------------- multirule ---------------- */}
          <Cap>Westgard multirule sets on the measured SD</Cap>
          {mr ? (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><Th>Rule set</Th><Th right>False rejection / event</Th><Th right>Detection, first event</Th><Th right>Within two events</Th></tr></thead>
              <tbody>
                <tr className="border-t border-slate-100 bg-slate-50">
                  <Td cls="text-slate-700">Derived 1:K ({analyte.levels.map((l) => fmt(l.k, 1)).join(" / ")})</Td>
                  <Td right>{fmt(analyte.combinedPfr * 100, 2)}%</Td><Td right>{fmt(analyte.combinedPed * 100, 1)}%</Td><Td right cls="text-slate-400">—</Td>
                </tr>
                {mr.map((r) => (
                  <tr key={r.name} className="border-t border-slate-100">
                    <Td cls="text-slate-700">{r.name}</Td>
                    <Td right cls={r.pfr * 100 > settings.pfrBudget ? "text-rose-700" : "text-slate-700"}>{fmt(r.pfr * 100, 2)}%</Td>
                    <Td right cls={r.ped1 * 100 >= (analyte.pedReq ?? settings.pedTarget) ? "text-emerald-800" : "text-slate-700"}>{fmt(r.ped1 * 100, 1)}%</Td>
                    <Td right>{fmt(r.ped2 * 100, 1)}%</Td>
                  </tr>))}
              </tbody>
            </table>
          ) : <p className="text-xs text-slate-500">Needs CV, target and allowable error.</p>}
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Monte Carlo with the card's levels as one event, the critical shift of each level applied to every level. 2-2s, 4-1s and
            10x read across levels within the event and across consecutive events. "First event" is the Westgard convention;
            "within two events" counts the across-event rules.
          </p>

          {/* ---------------- measurement uncertainty ---------------- */}
          <Cap>Measurement uncertainty from IQC (ISO/TS 20914)</Cap>
          <div className="mb-1 flex flex-wrap items-center gap-3 text-xs text-slate-600">
            <label className="flex items-center gap-1">EQA bias % <NumberCell value={eqaBias} onChange={setEqaBias} width="w-20" /></label>
            <label className="flex items-center gap-1">u(reference) % <NumberCell value={uRef} onChange={setURef} width="w-20" /></label>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><Th>Level</Th><Th right>u(Rw) = CV %</Th><Th right>U, imprecision only</Th><Th right>Analyser offset %</Th><Th right>U with offset</Th><Th right>U with EQA bias</Th></tr></thead>
            <tbody>{mu.map((r) => (
              <tr key={r.label} className="border-t border-slate-100">
                <Td cls="font-mono text-slate-700">{r.label}</Td><Td right>{fmt(r.cv, 2)}</Td><Td right cls="font-semibold text-slate-900">{fmt(r.uImp, 2)}%</Td>
                <Td right>{fmt(r.off, 2)}</Td><Td right>{fmt(r.uOff, 2)}%</Td><Td right>{isFinite(r.uEqa) ? `${fmt(r.uEqa, 2)}%` : "—"}</Td>
              </tr>))}</tbody>
          </table>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            u(Rw) is the pooled within-lot CV; U = 2·√(u(Rw)² + u(bias)²), k = 2. The analyser offset is the largest departure of
            an analyser from the pooled mean; enter the EQA bias and the uncertainty of the reference value to get the full estimate.
          </p>

          {/* ---------------- lots and steps ---------------- */}
          {data ? (
            <div>
              <Cap>Reagent-lot transitions: first use of a new lot on the analyser (last 30 vs first 30 results)</Cap>
              {data.steps.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><Th>Level · analyser</Th><Th>Date</Th><Th>Lot → lot</Th><Th right>n</Th><Th right>Step (SD)</Th><Th right>p</Th></tr></thead>
                  <tbody>{data.steps.sort((a, b) => Math.abs(b.step) - Math.abs(a.step)).slice(0, 40).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <Td cls="font-mono text-slate-700">{r.level} · {r.instrument}</Td><Td cls="font-mono text-slate-600">{fmtDate(r.t)}</Td>
                      <Td cls="font-mono text-slate-600">{r.oldLot} → {r.newLot}</Td><Td right>{r.nb}/{r.na}</Td>
                      <Td right cls={Math.abs(r.step) >= 1 ? "text-rose-700" : "text-slate-700"}>{r.step > 0 ? "+" : ""}{fmt(r.step, 2)}</Td><Td right>{r.p < 0.001 ? "<0.001" : fmt(r.p, 3)}</Td>
                    </tr>))}</tbody>
                </table>
              ) : <p className="text-xs text-slate-500">No reagent-lot column in the imported data (cobas infinity "R1 lot").</p>}

              <Cap>Control-lot start: first 20 results against the lot's final mean</Cap>
              {data.lots.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><Th>Level</Th><Th>Lot</Th><Th right>n</Th><Th right>First 20 mean</Th><Th right>Final mean</Th><Th right>Difference (SD)</Th><Th right>LIS target set</Th><Th right>vs final (SD)</Th></tr></thead>
                  <tbody>{data.lots.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <Td cls="font-mono text-slate-700">{r.level}</Td><Td cls="font-mono text-slate-600">{r.lot}</Td><Td right>{r.n}</Td>
                      <Td right>{fmt(r.first, dd(r.final))}</Td><Td right>{fmt(r.final, dd(r.final))}</Td>
                      <Td right cls={Math.abs(r.dev) >= 0.5 ? "text-amber-800" : "text-slate-700"}>{r.dev > 0 ? "+" : ""}{fmt(r.dev, 2)}</Td>
                      <Td right>{r.lisTarget > 0 ? fmt(r.lisTarget, dd(r.final)) : "—"}</Td><Td right cls={Math.abs(r.lisDev) >= 1 ? "text-rose-700" : "text-slate-700"}>{isFinite(r.lisDev) ? `${r.lisDev > 0 ? "+" : ""}${fmt(r.lisDev, 2)}` : "—"}</Td>
                    </tr>))}</tbody>
                </table>
              ) : <p className="text-xs text-slate-500">No lot with 40 or more results.</p>}
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                A provisional target from n results has standard error SD/√n: 16 results give 0.25 SD, 25 give 0.2 SD. The difference
                column shows how far the first 20 results sat from where the lot ended up.
              </p>

              <Cap>Within-day and between-day imprecision, per analyser and control lot</Cap>
              {data.vc.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><Th>Level · analyser</Th><Th>Lot</Th><Th right>n</Th><Th right>Days</Th><Th right>CV within-day</Th><Th right>CV between-day</Th><Th right>CV total</Th></tr></thead>
                  <tbody>{data.vc.map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <Td cls="font-mono text-slate-700">{r.level} · {r.instrument}</Td><Td cls="font-mono text-slate-600">{r.lot}</Td><Td right>{r.n}</Td><Td right>{r.days}</Td>
                      <Td right>{fmt(r.within, 2)}%</Td><Td right cls={r.between > r.within ? "text-amber-800" : "text-slate-700"}>{fmt(r.between, 2)}%</Td><Td right>{fmt(r.total, 2)}%</Td>
                    </tr>))}</tbody>
                </table>
              ) : <p className="text-xs text-slate-500">Needs dated results, at least 10 days per lot.</p>}
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                One-way components by day (CLSI EP05 logic on routine data). A between-day CV larger than the within-day CV says that
                the analyser moves from day to day more than it scatters within a day: calibration and reagent effects, not noise.
              </p>

              <Cap>Change points in the analyser mean (binary segmentation)</Cap>
              {data.cps.length ? (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-slate-500"><Th>Level · analyser</Th><Th>Date</Th><Th>Control lot</Th><Th right>Step (SD)</Th><Th right>Statistic</Th><Th>Near reagent-lot change</Th></tr></thead>
                  <tbody>{data.cps.sort((a, b) => Math.abs(b.step) - Math.abs(a.step)).slice(0, 40).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <Td cls="font-mono text-slate-700">{r.level} · {r.instrument}</Td><Td cls="font-mono text-slate-600">{fmtDate(r.t)}</Td><Td cls="font-mono text-slate-600">{r.lot}</Td>
                      <Td right cls={Math.abs(r.step) >= 1 ? "text-rose-700" : "text-slate-700"}>{r.step > 0 ? "+" : ""}{fmt(r.step, 2)}</Td><Td right>{fmt(r.stat, 1)}</Td><Td>{r.nearR1 ? "yes" : ""}</Td>
                    </tr>))}</tbody>
                </table>
              ) : <p className="text-xs text-slate-500">No step above the threshold (statistic 4, segments of at least 15 results).</p>}
              <p className="mt-1 text-xs leading-relaxed text-slate-600">
                The series of each analyser, standardised against the lot mean, is split where the mean changes most; splits continue
                within segments while the standardised difference exceeds 4. Steps that coincide with a reagent-lot change are marked.
              </p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Import results (cobas infinity export with Date and R1 lot columns) for lots, steps and variance components.</p>
          )}
        </div>
      )}
    </div>
  );
}

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

      <Section title="One error, two levels: how the critical error is sized">
        <p>
          A systematic error has one size. If a calibration moves results by 3 %,
          it moves both control levels by 3 %. But the two levels have different
          CVs, so the same 3 % is a different number of SD at each: for sodium
          2.8 SD at L1 (CV 1.09 %) and 4.1 SD at L2 (CV 0.73 %). The tool
          therefore sizes the critical error once, in per cent, for the measurand:
        </p>
        <Formula>critical error = TEa − max over levels of (|offset| + z · CV)</Formula>
        <p>
          the smallest error that already breaks the allowable total error at
          one of the levels, usually the level with the larger CV. That error is
          converted into SD at each level with that level&rsquo;s own CV, the
          detection probability is read off each level&rsquo;s rule, and the
          probabilities are combined as 1 − Π(1 − p): the chance that at least
          one level rejects. This is the combined probability the card reports
          and the rule search optimises. The older convention, each level at its
          own critical shift (sigma − z), evaluates the levels at different error
          sizes and overstates the combined detection; it remains available in
          the settings bar for comparison. Westgard&rsquo;s N=2 power functions
          sit between the two: they assume the same shift in SD at both levels.
        </p>
      </Section>
      <Section title="A second sigma: CVI / CV (Oosterhuis and Coskun)">
        <p>
          Oosterhuis and Coskun argue that the usual sigma, (TEa − |bias|)/CV,
          rests on a tolerance that already contains a coverage factor and a bias
          term, and so reasons in a circle. They propose a sigma without TEa:
        </p>
        <Formula>σ = CVI / CV</Formula>
        <p>
          with the within-subject biological variation CVI as the tolerance, no
          coverage factor, and bias judged separately. Their benchmark is 4.65,
          which requires CV ≤ 0.22 · CVI. When a CVI is entered on the card, the
          header shows this value for the worst level beside the conventional
          sigma. It is reported for comparison only: it yields no tolerance from
          which a control limit can be sized, so the rules, the critical error and
          the detection probabilities on the card are unaffected by it. For the
          preloaded panel only ALT, TSH and ferritin exceed 4.65; sodium would need
          a CV of 0.11 %.
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

      <Section title="CUSUM: catching the slow drift">
        <p>
          The 1:K rule looks at one result at a time, so a shift of half an SD that
          persists for weeks never trips it. The cumulative sum chart (CUSUM) adds up
          the departures of successive results from the centre, discounting each by a
          reference value k, and alarms when the sum passes a decision limit h:
        </p>
        <Formula>C⁺ = max(0, C⁺ + z − k) · C⁻ = max(0, C⁻ − z − k) · alarm when C⁺ &gt; h or C⁻ &gt; h</Formula>
        <p>
          z is the result in SD units from the centre. k is half the shift the chart
          should catch quickly (0.5 for a 1 SD shift) and h sets the in-control alarm
          rate; k 0.5 with h 5 gives an average of about a thousand results between
          false alarms and catches a 1 SD shift in about ten results, where a 1:2.6
          rule needs about eighteen and alarms falsely every hundred. The run
          lengths shown are Siegmund&rsquo;s approximation. On imported data the
          chart restarts at every lot change and after every alarm; an alarm rate far
          above the expected one tells you that the analyser sits persistently off the
          centre, and the comparison of centres shows whether that is an analyser
          offset or drift within the lot. Use the CUSUM beside the 1:K rule, not
          instead of it: the single-result rule still catches the gross error.
        </p>
      </Section>
      <Section title="More models from the same control data">
        <p>
          Each card can open a second block that reuses the imported results for
          other laboratory-specific estimates. <span className="font-semibold text-slate-900">EWMA</span>:
          an exponentially weighted moving average of the standardised results, a
          smoother relative of the CUSUM with the same purpose; its run lengths are
          simulated. <span className="font-semibold text-slate-900">Multirule sets</span>:
          the classic Westgard combinations evaluated on the laboratory&rsquo;s measured
          SD rather than the manufacturer&rsquo;s, by simulation, with the card&rsquo;s
          critical shift; this shows whether a 1-3s/2-2s/R-4s set on the right SD does
          the job of the tuned single rule. <span className="font-semibold text-slate-900">Measurement
          uncertainty</span>: u(Rw) from the pooled within-lot CV and U = 2·√(u(Rw)² +
          u(bias)²) in the manner of ISO/TS 20914, with the analyser offset or an entered
          EQA bias as the bias term. <span className="font-semibold text-slate-900">Reagent-lot
          transitions</span>: the step of each analyser&rsquo;s mean at every R1 lot change,
          in SD, with a Welch test. <span className="font-semibold text-slate-900">Control-lot
          start</span>: how far the first 20 results of a lot sat from where the lot ended,
          and what the LIS target set at the time missed by. <span className="font-semibold text-slate-900">Variance
          components</span>: within-day and between-day CV per analyser and lot from daily
          means. <span className="font-semibold text-slate-900">Change points</span>: binary
          segmentation of each analyser&rsquo;s series, which dates the steps that the CUSUM
          alarms on and marks those that coincide with a reagent-lot change.
        </p>
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
          <li>
            Page ES. Continuous inspection schemes. Biometrika 1954;41:100–15.
          </li>
          <li>
            Westgard JO, Groth T, Aronsson T, de Verdier CH. Combined Shewhart-cusum
            control chart for improved quality control in clinical chemistry. Clin
            Chem 1977;23:1881–7.
          </li>
          <li>
            Siegmund D. Sequential analysis: tests and confidence intervals. New York:
            Springer; 1985.
          </li>
          <li>
            Roberts SW. Control chart tests based on geometric moving averages.
            Technometrics 1959;1:239–50.
          </li>
          <li>
            ISO/TS 20914:2019. Medical laboratories — practical guidance for the
            estimation of measurement uncertainty. Geneva: ISO; 2019.
          </li>
          <li>
            Oosterhuis WP, Coskun A. Sigma metrics in laboratory medicine revisited:
            we are on the right road with the wrong map. Biochem Med (Zagreb)
            2018;28:020503.
          </li>
          <li>
            Coskun A, Serteser M, Ünsal I. Sigma metric revisited: true known
            mistakes. Biochem Med (Zagreb) 2019;29:010902.
          </li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          The false rejection and error detection framework comes from references 1
          to 3. The sigma bands and the control plans attached to them are reference
          4. The CUSUM is reference 6, its use beside Shewhart rules in clinical
          chemistry reference 7, and the run-length approximation reference 8. Verify
          page numbers against the publisher record before submission.
        </p>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const STORE_KEY = "designlabiqc-clinchem-v4";

/* How the calculations were checked, and the result of the last test run. */
function ValidationView() {
  const V = VERIFICATION;
  const sections = [];
  for (const r of V.rows) {
    let s = sections.find((x) => x.name === r.section);
    if (!s) { s = { name: r.section, n: 0, pass: 0, rows: [] }; sections.push(s); }
    s.n++; if (r.pass) s.pass++; s.rows.push(r);
  }
  const f = (v) => (typeof v === "number" ? (Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(4)) : String(v));
  const [open, setOpen] = useState(null);
  return (
    <div className="space-y-5">
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900">How the tool was verified</h2>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-700">
          The calculations live in one module with no user interface (<code>tool/core.js</code>). An automated test suite
          runs that module against published values and against an independent implementation on every change to the
          code, and this tab shows the result of the last run: <span className="font-mono">{V.passed} of {V.n}</span> comparisons
          within tolerance ({V.generated}). The tool is a research prototype, not validated clinical software; what
          follows is verification of the arithmetic, not of clinical benefit.
        </p>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["A · Analytical", "Are the formulas right?", "Fixed cases against Westgard 1977 and 1981, Fraser 1997, Hawkins & Olwell 1998, the Lucas & Saccucci EWMA design, exact Gaussian values and an independent Markov-chain / Monte Carlo computation."],
            ["B · Software", "Do they stay right?", "The same tests run on every commit (GitHub Actions) and write the report shown here; a change that moves a tested number fails the build."],
            ["C · End to end", "Does it match the independent analysis?", "The preloaded panel (10 measurands, 20 levels, 27,963 results) computed here and in Python from the same export: sigma, critical error, combined detection and false rejection, and the rule search itself."],
            ["D · Use", "Can a laboratory scientist get the answer?", "Task-based user test with the System Usability Scale, planned after the October 2026 layout revision; not yet done."],
          ].map(([t, q, d]) => (
            <div key={t} className="rounded border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-teal-800">{t}</div>
              <div className="mt-1 text-sm font-medium text-slate-900">{q}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{d}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-slate-200 bg-white shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-300 text-left text-xs text-slate-600">
              <th className="px-4 py-2 font-medium">Section</th><th className="px-2 py-2 font-medium">Comparisons</th><th className="px-2 py-2 font-medium">Within tolerance</th><th className="px-2 py-2 font-medium">Reference</th><th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {sections.map((sec) => (
              <React.Fragment key={sec.name}>
                <tr className="border-b border-slate-100">
                  <td className="px-4 py-2 text-slate-900">{sec.name}</td>
                  <td className="px-2 py-2 font-mono text-xs">{sec.n}</td>
                  <td className="px-2 py-2"><span className={`rounded px-2 py-0.5 font-mono text-xs ${sec.pass === sec.n ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{sec.pass}/{sec.n}</span></td>
                  <td className="px-2 py-2 text-xs text-slate-600">{[...new Set(sec.rows.map((r) => r.source))].join("; ")}</td>
                  <td className="px-2 py-2 text-right"><button type="button" className="text-xs text-teal-800 underline" onClick={() => setOpen(open === sec.name ? null : sec.name)}>{open === sec.name ? "hide" : "show"}</button></td>
                </tr>
                {open === sec.name && (
                  <tr><td colSpan={5} className="bg-slate-50 px-4 py-2">
                    <table className="w-full text-xs">
                      <thead><tr className="text-left text-slate-500"><th className="py-1 pr-3 font-medium">Item</th><th className="py-1 pr-3 font-medium">Tool</th><th className="py-1 pr-3 font-medium">Reference</th><th className="py-1 pr-3 font-medium">Tolerance</th><th className="py-1 font-medium">Source</th></tr></thead>
                      <tbody>{sec.rows.map((r, i) => (
                        <tr key={i} className="border-t border-slate-200"><td className="py-1 pr-3 text-slate-800">{r.item}</td><td className="py-1 pr-3 font-mono">{f(r.tool)}</td><td className="py-1 pr-3 font-mono">{f(r.reference)}</td><td className="py-1 pr-3 font-mono">{f(r.tolerance)}</td><td className="py-1 text-slate-600">{r.source}</td></tr>
                      ))}</tbody>
                    </table>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm text-sm leading-relaxed text-slate-700">
        <h3 className="font-semibold text-slate-900">What is not verified</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>The importer (cobas infinity parsing, test-code mapping, Excel dates) is exercised by the recorded demo, not by unit tests; the ALT figures it produces were checked by hand against the Python CV.</li>
          <li>Measurement uncertainty follows ISO/TS 20914 formulas; no external worked example has been compared. Variance components are checked for internal consistency only.</li>
          <li>Browser rendering, saving in the browser and the CSV export are not tested automatically.</li>
          <li>Nothing here shows that the derived rules improve patient outcomes; the retrospective evaluation in the manuscript is the only outcome-level evidence.</li>
        </ul>
        <p className="mt-3 text-xs text-slate-500">Two reference values first written into the test file were wrong and were caught by the independent computation (EWMA ARL₀ for λ 0.2 / L 2.86 is about 370, not 500; multirule first-event detection at 2 SD is 0.42, not 0.52). The tool was right in both cases; the test file was corrected and the reference script kept in the repository. Full document: docs/VALIDATION.md. Run: <code>npm test</code>.</p>
      </div>
    </div>
  );
}

/* Layer 1: the whole panel on one screen. One row per analyte; click to open. */
function OverviewTable({ computed, panels, settings, onOpen }) {
  const th = (t, title) => <th className="py-2 pr-3 text-left text-xs font-medium text-slate-600" title={title}>{t}</th>;
  const td = (t, cls = "") => <td className={`py-1.5 pr-3 font-mono text-xs text-slate-800 ${cls}`}>{t}</td>;
  return (
    <div className="rounded-md border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto px-4 py-3">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="border-b border-slate-300">
              {th("Analyte")}{th("Allowable error", "Adopted source and limit")}{th("Sigma L1 / L2")}{th("Crit. error %", "One size for the measurand, TEa − max(|offset| + z·CV)")}{th("K L1 / L2", "Rejection limit per level, observed SD")}{th("False rej.", "Combined per control event")}{th("Detection", "Combined probability of detecting the critical error, and the requirement")}{th("LIS target ± SD to enter")}{th("Status")}
            </tr>
          </thead>
          <tbody>
            {panels.map((panel) => {
              const group = computed.filter((a) => (a.panel || "Imported") === panel);
              if (!group.length) return null;
              return [
                <tr key={panel + "-h"}><td colSpan={9} className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{panel}</td></tr>,
                ...group.map((a) => {
                  const req = a.pedReq ?? settings.pedTarget;
                  const ok = a.ready && a.pfrOk && a.pedOk;
                  return (
                    <tr key={a.id} onClick={() => onOpen(a.id)} className="cursor-pointer border-b border-slate-100 odd:bg-slate-50/60 hover:bg-teal-50" title="Open">
                      <td className="py-1.5 pr-3 text-sm text-slate-900">{a.name}</td>
                      {td(a.ready ? `${a.teaSource} ${fmt(effectiveTea(a), 1)}%` : "—")}
                      {td(a.ready ? a.levels.map((l) => fmt(l.sigma, 1)).join(" / ") : "—")}
                      {td(a.ready && isFinite(a.critPct) ? fmt(a.critPct, 2) : "—")}
                      {td(a.ready ? a.levels.map((l) => fmt(l.k, 1)).join(" / ") : "—")}
                      {td(a.ready ? fmt(a.combinedPfr * 100, 2) + "%" : "—", a.ready && !a.pfrOk ? "text-rose-700" : "")}
                      {td(a.ready ? `${fmt(a.combinedPed * 100, 1)}% (≥${req})` : "—", a.ready && !a.pedOk ? "text-rose-700" : "")}
                      {td(a.ready ? a.levels.map(lisEntry).join("  ·  ") : "—")}
                      <td className="py-1.5 pr-3">
                        {!a.ready ? <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">needs {a.missing.join(", ")}</span>
                          : ok ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">meets both</span>
                          : <span className="rounded bg-rose-50 px-2 py-0.5 text-xs text-rose-800">{!a.pfrOk ? "false rejection over allowance" : "detection below requirement"}</span>}
                      </td>
                    </tr>
                  );
                }),
              ];
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500">
        Each row is one measurand under the settings above. Click a row to see the levels, the sources, the power curves and the monitoring charts. Search all re-derives every rule; Export CSV writes this table with the notes.
      </p>
    </div>
  );
}

export default function IqcRuleDesigner() {
  const [analytes, setAnalytes] = useState(DEFAULT_ANALYTES);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [status, setStatus] = useState("Loading saved work…");
  const [tab, setTab] = useState("overview");
  const [selectedId, setSelectedId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [importNote, setImportNote] = useState("");
  // Imported result series for the CUSUM, by analyte name -> level -> instrument -> lot.
  // Kept in memory for the session; not saved with the work.
  const [series, setSeries] = useState({});
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
      // raw: keep cells as text, so that dd/mm/yyyy dates are not re-read as
      // mm/dd and turned into serial numbers
      const wb = XLSX.read(buf, { type: "array", raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
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
      // Target and SD the LIS was using (cobas infinity "Target value" / "SD", or the
      // prepared file's target_in_force / sd_defined_in_lis); the latest pair is kept.
      const kTgt = key(first, "target value", "target", "target_in_force", "lis target");
      const kSd = key(first, "sd", "sd_defined_in_lis", "lis sd");
      const kDate = key(first, "date", "timestamp", "time");
      const kR1 = key(first, "r1 lot", "reagent_lot_r1", "reagent lot");
      const lisOf = {}; // analyte -> level -> {t, target, sd}
      const when = (v) => {
        if (v instanceof Date) return v.getTime();
        if (typeof v === "number" && v > 20000 && v < 80000) return (v - 25569) * 86400000; // Excel serial
        const s = String(v).trim();
        const m = s.match(/^(\d{2})[./](\d{2})[./](\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
        if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
        const t = Date.parse(s);
        return isFinite(t) ? t : 0;
      };
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
      const ser = {}; // analyte -> level -> instrument -> lot -> [{t, v}]
      let rowIdx = 0;
      for (const r of rows) {
        rowIdx++;
        const rawName = String(r[kA]).trim();
        const a = TEST_CODES[rawName] || rawName;
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
        ((((ser[a] ??= {})[lv] ??= {})[ins] ??= {})[lot] ??= []).push({
          t: kDate ? when(r[kDate]) || rowIdx : rowIdx, v: val,
          r1: kR1 ? String(r[kR1]).trim() : "", target: kTgt ? num(r[kTgt]) : NaN,
        });
        if (kTgt && kSd) {
          const tg = num(r[kTgt]), sdv = num(r[kSd]);
          if (isFinite(tg) && isFinite(sdv) && tg > 0 && sdv > 0) {
            const t = kDate ? when(r[kDate]) : 0;
            const cur = (lisOf[a] ??= {})[lv];
            if (!cur || t >= cur.t) lisOf[a][lv] = { t, target: tg, sd: sdv };
          }
        }
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
        const nextLis = {};
        const nextSer = {};
        ranked.forEach((l, i) => {
          next[`L${i + 1}`] = lvls[l];
          if (lisOf[a]?.[l]) nextLis[`L${i + 1}`] = lisOf[a][l];
          if (ser[a]?.[l]) nextSer[`L${i + 1}`] = ser[a][l];
        });
        tree[a] = next;
        if (lisOf[a]) lisOf[a] = nextLis;
        if (ser[a]) ser[a] = nextSer;
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
            cvOf[a][lv] = { ...worst, target, maxDev, lis: lisOf[a]?.[lv] || null };
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
          if (c.lis) {
            next.lisTarget = Number(c.lis.target.toPrecision(6));
            next.lisSd = Number(c.lis.sd.toPrecision(4));
          }
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
      // time order within each lot, for the CUSUM
      for (const lv of Object.values(ser)) for (const ins of Object.values(lv)) for (const lots of Object.values(ins))
        for (const pts of Object.values(lots)) pts.sort((p, q) => p.t - q.t);
      const serByName = {};
      for (const an of [...updated, ...fresh]) {
        const hit = Object.keys(ser).find((k) => k.toLowerCase() === an.name.trim().toLowerCase());
        if (hit) serByName[an.name] = ser[hit];
      }
      // Merge with series imported earlier in the session (several export
      // periods of the same analyte), keeping time order within each lot.
      setSeries((prev) => {
        const next = { ...prev };
        for (const [name, lv] of Object.entries(serByName)) {
          const tgt = (next[name] = { ...(next[name] || {}) });
          for (const [l, ins] of Object.entries(lv)) {
            const tl = (tgt[l] = { ...(tgt[l] || {}) });
            for (const [i, lots] of Object.entries(ins)) {
              const ti = (tl[i] = { ...(tl[i] || {}) });
              for (const [lot, pts] of Object.entries(lots)) {
                const seen = new Set((ti[lot] || []).map((p) => `${p.t}|${p.v}`));
                ti[lot] = [...(ti[lot] || []), ...pts.filter((p) => !seen.has(`${p.t}|${p.v}`))].sort((p, q) => p.t - q.t);
              }
            }
          }
        }
        return next;
      });
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
        "LIS target now",
        "LIS SD now",
        "K now (measured SD)",
        "False alarm now %",
        "Detection now",
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
          l.hasLis ? l.lisTarget : "",
          l.hasLis ? l.lisSd : "",
          l.hasLis ? fmt(l.lisK, 2) : "",
          l.hasLis ? fmt(l.lisPfr * 100, 3) : "",
          l.hasLis ? fmt(l.lisPed, 3) : "",
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

  const currentId = computed.some((a) => a.id === selectedId) ? selectedId : (computed[0] && computed[0].id);
  const searchAll = () => {
    let n = 0;
    setAnalytes((prev) => prev.map((a) => {
      const c = computeAnalyte(a, settings);
      if (!c.ready) return a;
      const res = searchRules(a, settings, "balanced");
      if (!res) return a;
      n++;
      return { ...a, levels: a.levels.map((l, i) => (l.locked ? l : { ...l, k: res.ks[i] })) };
    }));
    setImportNote(`Rule search applied to ${n} analyte${n === 1 ? "" : "s"} (best combined detection within the ${settings.pfrBudget}% false-alarm allowance). Locked levels were left as they were.`);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/70 via-slate-100 to-slate-100 text-slate-900">
      <div className="bg-teal-950 text-white">
        <div className="mx-auto max-w-7xl px-5 py-7">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300">DesignLabIQC · ClinChem</div>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                Internal quality control for clinical chemistry and immunochemistry
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-teal-100">
                Control rules built from the imprecision your own instruments produce,
                rather than from a fixed range someone else measured. Enter your figures,
                see what each rule would catch and what it would cost in needless
                rejections, and read off the target and SD to put into your laboratory system.
              </p>
            </div>
            <div className="font-mono text-xs text-teal-200">Verified {VERIFICATION.passed}/{VERIFICATION.n} · {VERIFICATION.generated}</div>
          </div>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-5 py-6">

        <nav className="mb-6 flex gap-6 border-b border-slate-300">
          {[
            ["overview", "Overview"],
            ["design", "Rule design"],
            ["compare", "Maker ranges"],
            ["method", "Method and references"],
            ["validation", "Validation"],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-1 pb-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-600 ${
                tab === id
                  ? "border-teal-700 font-semibold text-teal-900"
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
        {tab === "validation" && <ValidationView />}

        {(tab === "design" || tab === "overview") && (
          <>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm shadow-sm">
          <button type="button" onClick={() => setShowSettings((v) => !v)} className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50" title="Show or hide the design settings">
            {showSettings ? "Hide settings" : "Settings"}
          </button>
          <span className="font-mono text-xs text-slate-600">
            false alarm ≤ {settings.pfrBudget}% · detection ≥ {settings.pedTarget}% · z {settings.zAlpha} · critical error: {settings.critMode === "common" ? "one size, all levels" : "each level its own"} · LIS rule {settings.qmMultiplier} SD
          </span>
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
              title="Load a results file (cobas infinity export or columns analyte, level, lot, instrument, result) and set each CV to the pooled within-lot value of the worst instrument"
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              Import results
            </button>
            <button
              onClick={searchAll}
              title="Run the rule search (best combined detection) for every analyte that has an allowable error and a CV, and apply the result"
              className="rounded bg-teal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
            >
              Search all
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

        {showSettings && (
        <div className="mb-6 flex flex-wrap items-end gap-x-8 gap-y-4 rounded-md border border-slate-200 bg-white px-4 py-4 shadow-sm">
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
            <span className="mb-1 block">Critical error</span>
            <select
              value={settings.critMode}
              onChange={(e) => setSettings({ ...settings, critMode: e.target.value })}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 focus:border-teal-600 focus:outline-none"
              title="One error size for the measurand, converted at each level with its own CV, or each level at its own critical shift"
            >
              <option value="common">One size, all levels</option>
              <option value="perlevel">Each level its own</option>
            </select>
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

        </div>
        )}

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

        {tab === "overview" && (
          <OverviewTable computed={computed} panels={panels} settings={settings} onOpen={(id) => { setSelectedId(id); setTab("design"); }} />
        )}

        {tab === "design" && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-[13rem_minmax(0,1fr)]">
          <aside className="space-y-4">
            {panels.map((panel) => {
              const group = computed.filter((a) => (a.panel || "Imported") === panel);
              if (!group.length) return null;
              return (
                <div key={panel}>
                  <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{panel}</h2>
                  <ul className="rounded-md border border-slate-200 bg-white shadow-sm">
                    {group.map((a) => {
                      const active = a.id === currentId;
                      const tone = !a.ready ? "bg-slate-300" : a.pfrOk && a.pedOk ? "bg-emerald-500" : "bg-rose-500";
                      return (
                        <li key={a.id}>
                          <button type="button" onClick={() => setSelectedId(a.id)}
                            className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${active ? "bg-teal-50 font-medium text-slate-900" : "text-slate-700 hover:bg-slate-50"}`}>
                            <span className={`inline-block h-2 w-2 rounded-full ${tone}`} aria-hidden="true" />
                            <span className="truncate">{a.name}</span>
                            {a.ready && <span className="ml-auto font-mono text-[11px] text-slate-500">{a.levels.map((l) => fmt(l.k, 1)).join("/")}</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
            <button type="button" onClick={addAnalyte} className="w-full rounded border border-dashed border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">+ Add analyte</button>
          </aside>
          <div className="min-w-0">
            {computed.filter((a) => a.id === currentId).map((a) => (
                  <AnalytePanel
                    key={a.id}
                    analyte={a}
                    settings={settings}
                    series={series[a.name]}
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
        </div>
        )}
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
