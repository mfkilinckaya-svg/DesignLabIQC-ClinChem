// Verification of the calculation core against published values and the
// independent Python implementation in analysis/. Run: node --test tool/test
// Every tolerance is stated next to the assertion; docs/VALIDATION.md lists
// the sources.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as C from "../core.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, expected ${b} ± ${tol}`);
const REPORT = [];
const rec = (section, item, tool, ref, tol, source) => REPORT.push({ section, item, tool, ref, tol, pass: Math.abs(tool - ref) <= tol, source });

/* ---------- 1. Gaussian tail and the 1:K rule ---------- */
test("normal CDF against tabulated values (Abramowitz & Stegun 26.2)", () => {
  const T = [[0, 0.5], [1, 0.8413447461], [1.65, 0.9505285320], [1.96, 0.9750021049], [2, 0.9772498681], [2.5, 0.9937903347], [3, 0.9986501020], [4, 0.9999683288], [5, 0.9999997133]];
  for (const [z, p] of T) { near(C.normCdf(z), p, 1e-9, `Φ(${z})`); rec("Normal CDF", `Φ(${z})`, C.normCdf(z), p, 1e-9, "A&S Table 26.1"); }
});

test("false rejection of 1:K rules, N = 1 (Westgard et al. 1977, Table 1; exact Gaussian)", () => {
  const T = [[2, 0.0455003], [2.5, 0.0124193], [3, 0.0026998], [3.5, 0.0004653], [4, 0.0000633]];
  for (const [k, p] of T) { near(C.falseRejection(k, 1), p, 1e-6, `Pfr 1:${k}s`); rec("1:K rule", `Pfr 1:${k}s, N=1`, C.falseRejection(k, 1), p, 1e-6, "Westgard 1977 / Gaussian"); }
});

test("false rejection with N controls per event combines as 1 − (1 − p)^N", () => {
  near(C.falseRejection(2, 2), 1 - (1 - 0.0455003) ** 2, 1e-6, "Pfr 1:2s N=2 (0.089)");
  near(C.falseRejection(3, 4), 1 - (1 - 0.0026998) ** 4, 1e-6, "Pfr 1:3s N=4");
  rec("1:K rule", "Pfr 1:2s, N=2", C.falseRejection(2, 2), 0.0889, 1e-3, "Westgard 1977 Table 1 (0.09)");
});

test("error detection of 1:K rules at a systematic shift ΔSE (Westgard 1977 power functions)", () => {
  // Ped = P(z > k − Δ) + P(z < −k − Δ)
  const T = [[2, 1, 1, 0.1587 + 0.0013], [2, 2, 1, 0.5000 + 0.0000317], [3, 2, 1, 0.1587 + 0.0], [3, 3, 1, 0.5000], [2.5, 2.5, 1, 0.5000], [3, 4, 1, 0.8413]];
  for (const [k, d, n, p] of T) { near(C.errorDetection(k, n, d), p, 2e-4, `Ped 1:${k}s Δ=${d}`); rec("1:K rule", `Ped 1:${k}s, ΔSE=${d} SD, N=${n}`, C.errorDetection(k, n, d), p, 2e-4, "Westgard 1977 Fig. 2 / Gaussian"); }
  // N = 2, same shift at both: Westgard 1977 Table 2, 1:3s N=2 at ΔSE=3 → 0.75
  near(C.errorDetection(3, 2, 3), 1 - 0.5 * 0.5, 1e-3, "Ped 1:3s N=2 Δ=3");
  rec("1:K rule", "Ped 1:3s, ΔSE=3, N=2", C.errorDetection(3, 2, 3), 0.75, 1e-3, "Westgard 1977 Table 2");
});

test("combined probability over levels is 1 − Π(1 − p)", () => {
  near(C.combine([0.2, 0.5]), 0.6, 1e-12, "combine");
  near(C.combine([0.0027, 0.0124]), 1 - (1 - 0.0027) * (1 - 0.0124), 1e-12, "combine Pfr");
});

/* ---------- 2. Allowable error from biological variation ---------- */
test("Fraser 1997 tiers from CVI/CVG", () => {
  const des = C.BV_TIERS.find((t) => t.key === "desirable");
  const opt = C.BV_TIERS.find((t) => t.key === "optimal");
  // creatinine CVI 4.4, CVG 16.1 → desirable 1.65·0.5·4.4 + 0.25·√(4.4²+16.1²) = 3.63 + 4.173 = 7.80
  near(C.bvTea(4.4, 16.1, des), 7.803, 0.005, "creatinine desirable");
  rec("BV tiers", "Creatinine desirable TEa (CVI 4.4, CVG 16.1)", C.bvTea(4.4, 16.1, des), 7.80, 0.01, "Fraser 1997 formula");
  near(C.bvTea(0.5, 0.7, opt), 1.65 * 0.25 * 0.5 + 0.125 * Math.sqrt(0.25 + 0.49), 1e-9, "sodium optimal");
  assert.ok(Number.isNaN(C.bvTea("", 1, des)), "missing CVI → NaN");
});

/* ---------- 3. Sigma, critical error, rules: tool vs Python ---------- */
const R = JSON.parse(fs.readFileSync(new URL("../../results/rule_search_results.json", import.meta.url), "utf8"));
const S = C.DEFAULT_SETTINGS;

test("sigma and critical error of the preloaded panel equal the Python analysis", () => {
  for (const o of R) {
    const a = C.DEFAULT_ANALYTES.find((x) => x.name === o.analyte);
    assert.ok(a, `panel has ${o.analyte}`);
    const r = C.computeAnalyte(a, S);
    near(r.critPct, o.chosen.crit, 0.01, `${o.analyte} critical error %`);
    rec("Panel vs Python", `${o.analyte}: critical error %`, +r.critPct.toFixed(3), o.chosen.crit, 0.01, "analysis/rule_search.py");
    r.levels.forEach((l, i) => { near(l.sigma, o.chosen.sigma[i], 0.02, `${o.analyte} sigma L${i + 1}`); rec("Panel vs Python", `${o.analyte}: sigma L${i + 1}`, +l.sigma.toFixed(3), +o.chosen.sigma[i].toFixed(3), 0.02, "analysis/rule_search.py"); });
  }
});

test("combined detection and false rejection of the adopted rules equal the Python analysis", () => {
  for (const o of R) {
    const a = C.DEFAULT_ANALYTES.find((x) => x.name === o.analyte);
    assert.deepEqual(a.levels.map((l) => Number(l.k)), o.chosen.ks, `${o.analyte} preloaded K`);
    const r = C.computeAnalyte(a, S);
    near(r.combinedPed * 100, o.chosen.ped * 100, 0.1, `${o.analyte} Ped %`);
    near(r.combinedPfr * 100, o.chosen.pfr * 100, 0.01, `${o.analyte} Pfr %`);
    rec("Panel vs Python", `${o.analyte}: combined Ped %`, +(r.combinedPed * 100).toFixed(2), +(o.chosen.ped * 100).toFixed(2), 0.1, "analysis/rule_search.py");
    rec("Panel vs Python", `${o.analyte}: combined Pfr %`, +(r.combinedPfr * 100).toFixed(3), +(o.chosen.pfr * 100).toFixed(3), 0.01, "analysis/rule_search.py");
  }
});

test("rule search from K = 3 at both levels reproduces the Python search for every measurand", () => {
  for (const o of R) {
    const a = C.DEFAULT_ANALYTES.find((x) => x.name === o.analyte);
    const start = { ...a, levels: a.levels.map((l) => ({ ...l, k: 3, locked: false })) };
    const res = C.searchRules(start, S, "balanced");
    const ks = res.ks.map(Number);
    assert.deepEqual(ks, o.chosen.ks, `${o.analyte} search K`);
    rec("Rule search", `${o.analyte}: K L1/L2`, ks.join("/") === o.chosen.ks.join("/") ? 1 : 0, 1, 0, "analysis/rule_search.py");
  }
});

/* ---------- 4. CUSUM and EWMA run lengths ---------- */
test("CUSUM ARL (Siegmund) against Hawkins & Olwell 1998 table, k = 0.5, h = 5", () => {
  // Exact ARL0 = 465; Siegmund's approximation gives 469 (within 1%)
  near(C.cusumArl0(0.5, 5), 465, 465 * 0.02, "ARL0");
  rec("CUSUM", "ARL0, k 0.5 h 5", +C.cusumArl0(0.5, 5).toFixed(1), 465, 9.3, "Hawkins & Olwell 1998 (exact 465)");
  // one-sided ARL at shift 1 SD: 10.4
  near(C.cusumArl(1, 0.5, 5), 10.4, 0.5, "ARL1");
  rec("CUSUM", "ARL at 1 SD shift", +C.cusumArl(1, 0.5, 5).toFixed(2), 10.4, 0.5, "Hawkins & Olwell 1998");
  // shift 2 SD: 4.0 ; shift 0.5: 38
  near(C.cusumArl(2, 0.5, 5), 4.0, 0.3, "ARL2");
  near(C.cusumArl(0.5, 0.5, 5), 38, 2, "ARL0.5");
});

test("CUSUM run on a stepped series alarms after the step and not before", () => {
  const z = Array.from({ length: 200 }, (_, i) => (i < 100 ? 0 : 1.0));
  const { alarms } = C.runCusum(z, 0.5, 5);
  assert.ok(alarms.length >= 1 && alarms[0].i >= 100 && alarms[0].i <= 112, `first alarm ${JSON.stringify(alarms[0])}`);
});

const REF = JSON.parse(fs.readFileSync(new URL("../../results/verification_references.json", import.meta.url), "utf8"));
test("EWMA ARL (Monte Carlo) against the Markov-chain ARL (Brook & Evans; Lucas & Saccucci design λ = 0.2, L = 2.86 → ARL0 ≈ 370)", () => {
  const a0 = C.ewmaArl(0, 0.2, 2.86, 3000);
  near(a0, REF.ewma_arl0_l02_L286, REF.ewma_arl0_l02_L286 * 0.1, "ARL0");
  rec("EWMA", "ARL0, λ 0.2 L 2.86", +a0.toFixed(0), +REF.ewma_arl0_l02_L286.toFixed(0), 37, "Markov chain (analysis/verify_references.py); Lucas & Saccucci 1990 ≈ 370");
  const a1 = C.ewmaArl(1, 0.2, 2.86, 3000);
  near(a1, REF.ewma_arl_1sd_l02_L286, 1.0, "ARL at 1 SD");
  rec("EWMA", "ARL at 1 SD shift", +a1.toFixed(2), +REF.ewma_arl_1sd_l02_L286.toFixed(2), 1.0, "Markov chain (analysis/verify_references.py)");
  const a5 = C.ewmaArl(0.5, 0.2, 2.86, 3000);
  near(a5, REF.ewma_arl_05sd_l02_L286, 4, "ARL at 0.5 SD");
  rec("EWMA", "ARL at 0.5 SD shift", +a5.toFixed(1), +REF.ewma_arl_05sd_l02_L286.toFixed(1), 4, "Markov chain (analysis/verify_references.py)");
});

/* ---------- 5. Multirule simulation ---------- */
test("multirule Pfr (N = 2) against Westgard 1981 Table 2", () => {
  const p13 = C.multirulePfr(new Set(["13s"]), 2, 20000);
  near(p13, REF.multirule_pfr_13s_N2_exact, 0.0015, "1-3s N=2");
  rec("Multirule", "Pfr 1-3s, N=2", +p13.toFixed(4), +REF.multirule_pfr_13s_N2_exact.toFixed(4), 0.0015, "Gaussian exact; Westgard 1981 Table 2 (0.01 rounded)");
  const pm = C.multirulePfr(new Set(["13s", "22s", "R4s"]), 2, 20000);
  near(pm, REF.multirule_pfr_13s22sR4s_N2_mc, 0.003, "1-3s/2-2s/R-4s N=2");
  rec("Multirule", "Pfr 1-3s/2-2s/R-4s, N=2", +pm.toFixed(4), +REF.multirule_pfr_13s22sR4s_N2_mc.toFixed(4), 0.003, "Independent Monte Carlo (analysis/verify_references.py); Westgard 1981 ≈ 0.01");
  const p12 = C.multirulePfr(new Set(["12s"]), 2, 20000);
  near(p12, REF.multirule_pfr_12s_N2_exact, 0.01, "1-2s N=2");
  rec("Multirule", "Pfr 1-2s, N=2", +p12.toFixed(4), +REF.multirule_pfr_12s_N2_exact.toFixed(4), 0.01, "Gaussian exact; Westgard 1981 Table 2 (0.09)");
});

test("multirule Ped at a 2 SD shift (N = 2) against Westgard 1981 power function", () => {
  const r = C.multirulePed(new Set(["13s", "22s", "R4s"]), [2, 2], 6000);
  const first = r.first;
  near(first, REF.multirule_ped_13s22sR4s_N2_shift2_first_mc, 0.03, "Ped first event, Δ=2");
  rec("Multirule", "Ped 1-3s/2-2s/R-4s, ΔSE 2, N=2, first event", +first.toFixed(3), +REF.multirule_ped_13s22sR4s_N2_shift2_first_mc.toFixed(3), 0.03, "Independent Monte Carlo (analysis/verify_references.py)");
});

/* ---------- 6. Change points ---------- */
test("binary segmentation finds a single step in a noise-free series", () => {
  const z = Array.from({ length: 120 }, (_, i) => (i < 60 ? 0 : 1.5) + 0.001 * ((i * 7919) % 13 - 6));
  const cps = C.binseg(z, 15, 4);
  const idx = cps.map((c) => c.i);
  assert.ok(idx.some((i) => Math.abs(i - 60) <= 1), `change point near 60, got ${JSON.stringify(cps).slice(0, 80)}`);
});

/* ---------- 7. Edge cases ---------- */
test("edge cases: missing CV, bias above TEa, per-level convention", () => {
  const a = structuredClone(C.DEFAULT_ANALYTES.find((x) => x.name === "Sodium"));
  a.levels[0].cv = "";
  assert.ok(!C.computeAnalyte(a, S).ready, "missing CV → not ready");
  const b = structuredClone(C.DEFAULT_ANALYTES.find((x) => x.name === "Sodium"));
  b.levels[1].bias = 10;
  const rb = C.computeAnalyte(b, S);
  assert.ok(rb.critPct < 0 || rb.combinedPed === 0 || rb.levels[1].ped === 0, "bias above TEa gives no detection");
  const rc = C.computeAnalyte(C.DEFAULT_ANALYTES.find((x) => x.name === "Sodium"), { ...S, critMode: "perlevel" });
  assert.ok(Number.isNaN(rc.critPct) && rc.combinedPed > 0.95, "per-level convention: no common crit, higher combined Ped");
});

/* ---------- 8. The laboratory's own QC design spreadsheet ---------- */
// 36 analyte-level rows of the spreadsheet used in routine practice
// (data/verification/lab_design_spreadsheet_rows.csv: inputs and the values
// the spreadsheet computed). Same inputs, per-level critical error.
test("laboratory QC design spreadsheet: 36 rows reproduced", () => {
  const txt = fs.readFileSync(new URL("../../data/verification/lab_design_spreadsheet_rows.csv", import.meta.url), "utf8").trim().split("\n");
  const head = txt[0].split(",");
  const rows = txt.slice(1).map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
  const PL = { ...S, critMode: "perlevel" };
  let worst = 0;
  for (const r of rows) {
    const L = C.computeLevel({ target: +r.target, cv: +r.cv_pct, n: +r.n_controls, k: +r.k, bias: +r.bias_pct }, +r.tea_pct, PL);
    const pairs = [[L.teaAsSd, +r.xl_tea_as_sd], [L.criticalShift, +r.xl_critical_shift_sd], [L.pfr, +r.xl_pfr], [L.ped, +r.xl_ped], [L.actionLimit, +r.xl_action_limit]];
    for (const [a, b] of pairs) worst = Math.max(worst, Math.abs(a - b));
  }
  near(worst, 0, 1e-12, "largest |tool − spreadsheet| over 36 rows × 5 outputs");
  rec("Lab spreadsheet", "max |tool − spreadsheet|, 36 rows × 5 outputs", worst, 0, 1e-12, "Laboratory QC design spreadsheet (in routine use)");
});

/* ---------- 9. Values stated by Westgard ---------- */
test("values stated in Westgard & Groth 1979 and Westgard et al. 1981", () => {
  // 1-2s used as a rejection rule: about 5, 10, 14, 18 and 26 % for N = 1, 2, 3, 4, 6 (Westgard 1981, p. 499)
  for (const [n, p] of [[1, 0.05], [2, 0.10], [3, 0.14], [4, 0.18], [6, 0.26]]) {
    near(C.falseRejection(2, n), p, 0.02, `Pfr 1-2s N=${n}`);
    rec("Westgard 1979/1981", `Pfr 1-2s, N=${n} (stated ≈${p})`, C.falseRejection(2, n), p, 0.02, "Westgard et al. 1981, p. 499");
  }
  // 1-3s, N = 2: probability 0.50 at a shift of about 2.5 SD (Westgard & Groth 1979, p. 866)
  const d50 = C.shiftForDetection(3, 2, 0.5);
  near(d50, 2.5, 0.1, "1-3s N=2, Ped 0.50");
  rec("Westgard 1979/1981", "1-3s, N=2: shift with Ped 0.50 (SD)", d50, 2.5, 0.1, "Westgard & Groth 1979, p. 866");
  // a 3.4 SD shift at Ped ≥ 0.90 needs N = 3 with 1-3s; N = 2 is not enough (p. 867)
  assert.ok(C.errorDetection(3, 2, 3.4) < 0.9 && C.errorDetection(3, 3, 3.4) >= 0.9, "1-3s at 3.4 SD: N=2 < 0.90 ≤ N=3");
  rec("Westgard 1979/1981", "1-3s at ΔSE 3.4 SD, N=3 (stated ≥ 0.90)", C.errorDetection(3, 3, 3.4), 0.9, 0.1, "Westgard & Groth 1979, p. 867");
});

/* ---------- 10. Westgard normalized OPSpecs charts ---------- */
// x-intercept (bias 0) of a rule's line = 100/sigma where Ped = 0.90 (or 0.50);
// chart values read from the online charts (±0.5 units).
test("normalized OPSpecs intercepts, N = 2", () => {
  const T = [[2, 0.9, 24], [2.5, 0.9, 21.5], [3, 0.9, 19.5], [3.5, 0.9, 17.5], [2, 0.5, 32], [3.5, 0.5, 21.5]];
  for (const [k, p, chart] of T) {
    const x = 100 / (C.shiftForDetection(k, 2, p) + 1.65);
    near(x, chart, 0.6, `OPSpecs 1-${k}s ${p * 100}% AQA`);
    rec("OPSpecs", `1-${k}s, N=2, ${p * 100}% AQA: x-intercept`, x, chart, 0.6, "Westgard normalized OPSpecs chart (read)");
  }
});

/* ---------- 11. Multirules, run by run, against an independent simulation ---------- */
// analysis/verify_multirule_runbyrun.py (written from Westgard 1981, 400,000 sequences).
test("multirule Pfr and Ped run by run: tool vs independent simulation", () => {
  const ref = JSON.parse(fs.readFileSync(new URL("../../results/verification_multirule_runbyrun.json", import.meta.url), "utf8"));
  for (const [name, rs] of C.RULE_SETS) {
    if (!ref[name]) continue;
    const set = new Set(rs);
    const pfr = C.multirulePfr(set, 2, 200000);
    near(pfr, ref[name].Pfr, 0.0015, `Pfr ${name}`);
    rec("Multirule run by run", `Pfr ${name}, N=2`, pfr, ref[name].Pfr, 0.0015, "Independent simulation (Westgard 1981 definitions)");
    for (const s of [1.35, 2.35, 3.35]) {
      const p = C.multirulePed(set, [s, s], 40000);
      near(p.first, ref[name][`Ped1_${s}`], 0.01, `Ped first ${name} ${s}`);
      near(p.two, ref[name][`Ped2_${s}`], 0.01, `Ped two ${name} ${s}`);
      rec("Multirule run by run", `Ped ${name}, ΔSE ${s}, first run`, p.first, ref[name][`Ped1_${s}`], 0.01, "Independent simulation");
      rec("Multirule run by run", `Ped ${name}, ΔSE ${s}, within two runs`, p.two, ref[name][`Ped2_${s}`], 0.01, "Independent simulation");
    }
  }
});

/* ---------- report ---------- */
test("write verification report", () => {
  const out = new URL("../../results/tool_verification.csv", import.meta.url);
  const lines = ["section,item,tool,reference,tolerance,pass,source", ...REPORT.map((r) => [r.section, r.item, r.tool, r.ref, r.tol, r.pass, r.source].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))];
  fs.writeFileSync(out, lines.join("\n") + "\n");
  assert.ok(REPORT.every((r) => r.pass), "all recorded comparisons pass");
});
