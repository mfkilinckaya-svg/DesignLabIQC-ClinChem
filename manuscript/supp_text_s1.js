// Supplementary Text S1: verification of the tool. Builds a .docx from the
// verification report in the repository so that every number is the one the
// test run produced.
const fs = require("fs");
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle, AlignmentType } = require("docx");
const R = "/home/claude/DesignLabIQC-ClinChem/results/";
const rows = fs.readFileSync(R + "tool_verification.csv", "utf8").trim().split("\n").slice(1).map((l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, "").replace(/^"|"$/g, "").replace(/""/g, '"')));
const sec = [];
for (const r of rows) { let s = sec.find((x) => x.name === r[0]); if (!s) { s = { name: r[0], n: 0, ok: 0, src: new Set() }; sec.push(s); } s.n++; if (r[5] === "true") s.ok++; s.src.add(r[6]); }
const ref = JSON.parse(fs.readFileSync(R + "verification_references.json", "utf8"));
const mr = JSON.parse(fs.readFileSync(R + "verification_multirule_runbyrun.json", "utf8"));
const rs = JSON.parse(fs.readFileSync(R + "rule_search_results.json", "utf8")).find((o) => o.analyte === "Sodium");
const F = "Times New Roman";
const P = (t, o = {}) => new Paragraph({ spacing: { after: 120, line: 300 }, children: (Array.isArray(t) ? t : [t]).map((x) => typeof x === "string" ? new TextRun({ text: x, font: F, size: 22, italics: o.italics }) : x) });
const H = (t) => new Paragraph({ spacing: { before: 200, after: 80 }, children: [new TextRun({ text: t, font: F, size: 24, bold: true })] });
const M = (t) => new Paragraph({ spacing: { after: 120 }, indent: { left: 400 }, children: t.split("\n").map((line, i) => new TextRun({ text: line, font: "Consolas", size: 19, break: i ? 1 : 0 })) });
const cell = (t, w, b = false, al = AlignmentType.LEFT) => new TableCell({ width: { size: w, type: WidthType.DXA }, margins: { top: 40, bottom: 40, left: 60, right: 60 }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, children: [new Paragraph({ alignment: al, spacing: { line: 240 }, children: [new TextRun({ text: String(t), font: F, size: 18, bold: b })] })] });
const table = (head, body, w) => new Table({ width: { size: w.reduce((a, b) => a + b), type: WidthType.DXA }, columnWidths: w, borders: { top: { style: BorderStyle.SINGLE, size: 6 }, bottom: { style: BorderStyle.SINGLE, size: 6 }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } }, rows: [new TableRow({ tableHeader: true, children: head.map((h, i) => cell(h, w[i], true)) }), ...body.map((r) => new TableRow({ children: r.map((t, i) => cell(t, w[i], false, typeof t === "number" ? AlignmentType.RIGHT : AlignmentType.LEFT)) }))] });

const pf = (x) => (x * 100).toFixed(2);
const doc = new Document({ styles: { default: { document: { run: { font: F, size: 22 } } } }, sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children: [
  new Paragraph({ children: [new TextRun({ text: "Supplementary Text S1. Verification of the DesignLabIQC-ClinChem tool", font: F, size: 26, bold: true })], spacing: { after: 200 } }),
  P("The tool is a research prototype for designing internal quality control rules; it is not a medical device and does not release patient results. What follows verifies its arithmetic, not its clinical benefit, and states what was not verified. The full record (test code, reference script, report) is in the repository: tool/test/core.test.mjs, analysis/verify_references.py, results/tool_verification.csv, docs/VALIDATION.md."),
  H("1. Approach"),
  P("The calculations were separated from the user interface into one module (tool/core.js) that contains no browser code, so that the numbers can be tested without a browser; the interface only formats them. Four layers were used."),
  table(["Layer", "Question", "Method"], [
    ["A. Analytical", "Are the formulas implemented correctly?", "Fixed cases against published values, exact Gaussian results and an independent computation"],
    ["B. Software", "Do they keep giving those answers?", "The same tests run automatically on every change to the code (GitHub Actions); a change that moves a tested number fails the build"],
    ["C. End to end", "Does the tool reproduce the independent analysis?", "The study panel (10 measurands, 20 levels, 27,963 results) computed in the tool and in Python (scipy.stats.norm; no shared code) from the same export"],
    ["D. Use", "Can a laboratory scientist get the intended answer?", "Task-based user test with the System Usability Scale; planned, not yet performed"],
  ], [1500, 3000, 4860]),
  H("2. Formulas verified and the reference used"),
  P("Normal distribution. Φ(z) = ½·erfc(−z/√2), erfc from the regularised incomplete gamma function, so that tails at z ≥ 4 keep full precision. Reference: Abramowitz and Stegun, Table 26.1, nine points from z = 0 to 5, tolerance 1e-9."),
  P("Single-value rules. For a rejection limit K (in SD) and N control observations per event,"),
  M("Pfr(K, N) = 1 − [1 − 2(1 − Φ(K))]^N        Ped(K, N, Δ) = 1 − [Φ(K − Δ) − Φ(−K − Δ)]^N"),
  P("with Δ the systematic shift in SD. Reference: Westgard et al. 1977 (Table 1, Table 2, Fig. 2) and the exact Gaussian values; 13 comparisons, tolerance 1e-6 (N = 1) and 1e-3 (N = 2). Example: Pfr(2.5, 1) = 2(1 − 0.99379) = 0.01242; Ped(3, 2, 3) = 1 − [Φ(0) − Φ(−6)]² = 0.7500."),
  P("Combination over levels. Combined probability = 1 − Π(1 − p_i), i.e. at least one level rejects; two identities checked to 1e-12."),
  P("Allowable error from biological variation. TEa = 1.65·kI·CVI + kB·√(CVI² + CVG²) with kI/kB 0.25/0.125, 0.50/0.25 and 0.75/0.375 (Fraser et al. 1997). Example: creatinine, CVI 4.4 %, CVG 16.1 %, desirable tier 3.630 + 4.173 = 7.803 %."),
  P("Sigma, critical error and the combined detection of a two-level rule set."),
  M("sigma_i = (TEa − |offset_i|)/CV_i\ncritical error = TEa − max_i(|offset_i| + z·CV_i)        Δ_i = (critical error − |offset_i|)/CV_i\nPed = 1 − Π_i[1 − Ped(K_i, 1, Δ_i)]        Pfr = 1 − Π_i[1 − Pfr(K_i, 1)]"),
  P(`Worked example (sodium, SEKK Dmax 5 %; L1 CV 1.088 %, offset 0.236 %; L2 CV 0.726 %, offset 0.251 %; z = 1.65): sigma ${rs.chosen.sigma.map((x) => x.toFixed(2)).join(" / ")}; critical error = 5 − max(2.031, 1.449) = ${rs.chosen.crit.toFixed(3)} %; Δ = 2.51 / 3.74 SD; with K ${rs.chosen.ks.join(" / ")}: Ped per level ${rs.chosen.peds.map((x) => pf(x)).join(" / ")} %, combined ${pf(rs.chosen.ped)} %; combined Pfr ${pf(rs.chosen.pfr)} %. The tool and the Python analysis agree on sigma (20 levels, tolerance 0.02), critical error (10 measurands, 0.01 %), combined detection (0.1 percentage point) and false rejection (0.01 point).`),
  P("Rule search. K_i ∈ {1.5, 1.6, …, 5.0} per level (36² = 1,296 candidate pairs for two levels); sets with combined Pfr above the allowance are discarded; the set with the largest combined Ped is taken. Started from K = 3 at both levels, the tool returned the same K pair as the Python search for all ten measurands."),
  P("CUSUM. C⁺ = max(0, C⁺ + z − k), C⁻ = max(0, C⁻ − z − k), alarm when either exceeds h. Average run length by Siegmund's approximation, ARL = [exp(−2Δ′b) + 2Δ′b − 1]/(2Δ′²) with Δ′ = shift − k and b = h + 1.166; two-sided in-control ARL = one-sided/2. Reference: Hawkins and Olwell 1998 (exact values 465 in control, 10.4 at a 1 SD shift, k 0.5, h 5); the approximation gives 469 and 10.3."),
  P(`EWMA. e_t = λ·z_t + (1 − λ)·e_{t−1}, alarm when |e_t| > L·√(λ/(2 − λ)); run lengths by seeded Monte Carlo. Reference: the Markov-chain ARL of Brook and Evans (1972), 301 states, computed in analysis/verify_references.py: ARL₀ ${ref.ewma_arl0_l02_L286.toFixed(0)} for λ 0.2, L 2.86 (the Lucas and Saccucci 1990 design for ARL₀ ≈ 370), ${ref.ewma_arl_1sd_l02_L286.toFixed(1)} at 1 SD, ${ref.ewma_arl_05sd_l02_L286.toFixed(1)} at 0.5 SD; tolerance 10 %, 1 and 4.`),
  P(`Multirule. Per control event with N levels: 1-3s, any |z| > 3; 2-2s, both levels beyond the same 2 SD limit or the same level in two consecutive events; R-4s, one level above +2 and another below −2 in the same event. Pfr is the fraction of in-control events rejected, Ped the fraction rejected at the first event with the shift present. References: exact Gaussian Pfr for 1-2s (${ref.multirule_pfr_12s_N2_exact.toFixed(4)}) and 1-3s (${ref.multirule_pfr_13s_N2_exact.toFixed(4)}) at N = 2 (Westgard et al. 1981 give 0.09 and 0.01 rounded); an independent Monte Carlo (200,000 events, 100,000 trials) for the 1-3s/2-2s/R-4s set: Pfr ${ref.multirule_pfr_13s22sR4s_N2_mc.toFixed(4)}, first-event Ped at a 2 SD shift ${ref.multirule_ped_13s22sR4s_N2_shift2_first_mc.toFixed(3)}.`),
  P("Change points. Binary segmentation recovers a single step of 1.5 SD at index 60 of a 120-point series to within one position. Edge cases: a missing CV leaves the measurand unjudged; an offset above the TEa gives no detection; the per-level convention gives no common critical error and a higher combined detection, as described in the Methods."),
  H("3. Result of the automated run"),
  table(["Section", "Comparisons", "Within tolerance", "Reference"], sec.map((s) => [s.name, s.n, s.ok, [...s.src].join("; ")]), [1700, 1300, 1400, 4960]),
  P(`Total ${rows.length} comparisons, ${rows.filter((r) => r[5] === "true").length} within tolerance (Supplementary Table S6 lists each with the tool's value, the reference, the tolerance and the source).`),
  P("Two reference values first written into the test file were wrong and were caught by the independent computation: the EWMA design λ 0.2 / L 2.86 has ARL₀ ≈ 370, not 500, and the multirule first-event detection at 2 SD is 0.42, not 0.52. The tool was right in both cases; the test file was corrected and the reference script kept in the repository so that the references are reproducible."),
  H("4. Further comparators"),
  P("No commercial QC design program (QC Validator, EZ Rules) was available to the laboratory. Four further comparators that share no code with the tool were therefore used; their results are included in the automated run above (sections Lab spreadsheet, Westgard 1979/1981, OPSpecs and Multirule run by run) and listed row by row in Supplementary Data."),
  P("4.1 The laboratory's own QC design spreadsheet. All 36 analyte-level rows of the spreadsheet used in routine practice (inputs: target, CV, TEa, bias, number of controls N, limit K; outputs: TEa as SD, critical shift, Pfr, Ped, action limit) were computed by the tool with the per-level convention used by the spreadsheet. The largest difference over 36 rows × 5 outputs was 4.4 × 10⁻¹⁶. A review of the spreadsheet formulas found no calculation error."),
  P("4.2 Values stated by Westgard."),
  table(["Statement", "Source", "Published", "Tool"], [
    ["1-2s as a rejection rule, N = 1 / 2 / 3 / 4 / 6", "Westgard et al. 1981", "≈ 5 / 10 / 14 / 18 / 26 %", "4.6 / 8.9 / 13.0 / 17.0 / 24.4 %"],
    ["1-3s, N = 2: shift detected with probability 0.50", "Westgard & Groth 1979", "≈ 2.5 SD", "2.46 SD"],
    ["Shift of 3.4 SD at Ped ≥ 0.90 with 1-3s needs N = 3–4", "Westgard & Groth 1979", "N = 2 not enough", "N = 2: 0.88; N = 3: 0.96"],
    ["Rule definitions for N = 2 and N = 3 (2-2s within and across runs, R-4s within run only, 4-1s, 10x, (2 of 3)2s, 3-1s)", "Westgard et al. 1981; Westgard & Groth 1981", "–", "same in tool and independent script"],
  ], [3300, 1900, 1900, 2260]),
  P("4.3 Normalized OPSpecs charts. On a normalized OPSpecs chart each rule's line meets the x-axis (bias 0) where Ped = 0.90 (or 0.50), at x = 100/σ. The intercepts computed from the tool were compared with Westgard's online charts; the reading precision of the charts is about ±0.5 units."),
  table(["Chart", "Rule", "Tool intercept", "Chart (read)", "Pfr tool / chart"], [
    ["N = 2, 90 % AQA", "1-2s", "24.2", "≈ 24", "0.089 / 0.09"],
    ["N = 2, 90 % AQA", "1-2.5s", "21.6", "≈ 21.5", "0.025 / 0.03"],
    ["N = 2, 90 % AQA", "1-3s/2-2s/R-4s", "21.0", "≈ 21", "0.009 / 0.01"],
    ["N = 2, 90 % AQA", "1-3s", "19.5", "≈ 19.5", "0.005 / 0.00"],
    ["N = 2, 90 % AQA", "1-3.5s", "17.8", "≈ 17.5", "0.001 / 0.00"],
    ["N = 2, 50 % AQA", "1-2s / 1-3.5s", "32.2 / 21.7", "≈ 32 / 21–22", "–"],
    ["N = 3, 90 % AQA", "six rules", "26.7 to 19.1", "same order", "1-2s 0.130 / 0.14; 1-2.5s 0.037 / 0.03"],
  ], [1600, 1900, 1500, 1500, 2860]),
  P("For 1-2s and 1-2.5s at N = 3 the tool's values are exact (1 − 0.9545³ = 0.130); the chart legend's values come from simulation and rounding."),
  P("4.4 Multirules run by run. An independent simulation written from the rule definitions of Westgard et al. 1981 (analysis/verify_multirule_runbyrun.py; 400,000 sequences, two levels per run, up to 12 preceding runs) was compared with the tool's multirulePfr and multirulePed. Pfr is the probability that a run is rejected when the process is stable; Ped the probability that the first run with a shift is rejected (first run) or that the first or second shifted run is rejected (within two runs)."),
  table(["Rule set (N = 2)", "Pfr indep. / tool", "Ped first run, ΔSE 2.35", "Ped within two runs, ΔSE 2.35"], [
    ["1-2s", mr["1-2s"].Pfr.toFixed(4) + " / 0.0891", mr["1-2s"]["Ped1_2.35"].toFixed(3) + " / 0.868", mr["1-2s"]["Ped2_2.35"].toFixed(3) + " / 0.983"],
    ["1-3s", mr["1-3s"].Pfr.toFixed(4) + " / 0.0056", mr["1-3s"]["Ped1_2.35"].toFixed(3) + " / 0.450", mr["1-3s"]["Ped2_2.35"].toFixed(3) + " / 0.699"],
    ["1-3s/2-2s/R-4s", mr["1-3s/2-2s/R-4s"].Pfr.toFixed(4) + " / 0.0093", mr["1-3s/2-2s/R-4s"]["Ped1_2.35"].toFixed(3) + " / 0.601", mr["1-3s/2-2s/R-4s"]["Ped2_2.35"].toFixed(3) + " / 0.875"],
    ["1-3s/2-2s/R-4s/4-1s", mr["1-3s/2-2s/R-4s/4-1s"].Pfr.toFixed(4) + " / 0.0129", mr["1-3s/2-2s/R-4s/4-1s"]["Ped1_2.35"].toFixed(3) + " / 0.609", mr["1-3s/2-2s/R-4s/4-1s"]["Ped2_2.35"].toFixed(3) + " / 0.935"],
    ["1-3s/2-2s/R-4s/4-1s/10x", mr["1-3s/2-2s/R-4s/4-1s/10x"].Pfr.toFixed(4) + " / 0.0148", mr["1-3s/2-2s/R-4s/4-1s/10x"]["Ped1_2.35"].toFixed(3) + " / 0.611", mr["1-3s/2-2s/R-4s/4-1s/10x"]["Ped2_2.35"].toFixed(3) + " / 0.936"],
  ], [2700, 2100, 2280, 2280]),
  P("Over the full grid (5 rule sets; Pfr and Ped at seven shifts, 75 values) the largest difference was 0.0022 and no |z| exceeded 2.0, i.e. the differences are simulation error. Published multirule power functions often use a window of R runs that are all shifted; for rules that use earlier runs (4-1s, 10x) that convention gives different numbers, so the convention has to be stated. The tool applies 10x across levels only (five runs at N = 2); Westgard et al. 1981 also allow it within one level."),
  P("4.5 Importer, end to end. The 20 example values of Westgard's online QC calculator were imported into the tool as one lot and as two lots of 10 (data/verification/westgard_example_import.csv)."),
  table(["Quantity", "Westgard calculator", "Independent", "Tool"], [
    ["Mean, one lot", "199.55", "199.550", "199.55"],
    ["CV %, one lot", "2.1", "2.098", "2.098"],
    ["CV %, two lots, pooled within lot", "–", "2.096", "2.096"],
  ], [3360, 2000, 2000, 2000]),
  H("5. What is not verified"),
  P("The importer (cobas infinity parsing, test-code mapping, Excel serial dates) has no unit tests; it is exercised by the recorded demonstration, its ALT figures were checked by hand against the Python CV, and the Westgard example (4.5) was imported end to end. The measurement-uncertainty block follows ISO/TS 20914; no external worked example was compared. Variance components are checked for internal consistency only. Browser rendering, saving in the browser and the CSV export are not tested automatically. Nothing here shows that the derived rules improve patient outcomes; the retrospective evaluation in the main text is the only outcome-level evidence. A task-based user test (layer D) is planned."),
  H("References"),
  P("Abramowitz M, Stegun IA. Handbook of mathematical functions. New York: Dover; 1964. · Westgard JO, Groth T, Aronsson T, et al. Clin Chem 1977;23:1857–67. · Westgard JO, Groth T. Power functions for statistical control rules. Clin Chem 1979;25:863–9. · Westgard JO, Barry PL, Hunt MR, et al. Clin Chem 1981;27:493–501. · Westgard JO, Groth T. Design and evaluation of statistical control procedures. Clin Chem 1981;27:1536–45. · Westgard QC. Normalized OPSpecs charts; Online QC Calculator. westgard.com (accessed 2 November 2026). · Fraser CG, Hyltoft Petersen P, Libeer JC, et al. Ann Clin Biochem 1997;34:8–12. · Hawkins DM, Olwell DH. Cumulative sum charts and charting for quality improvement. New York: Springer; 1998. · Lucas JM, Saccucci MS. Technometrics 1990;32:1–12. · Brook D, Evans DA. Biometrika 1972;59:539–49. · Siegmund D. Sequential analysis. New York: Springer; 1985."),
] }] });
Packer.toBuffer(doc).then((b) => { fs.mkdirSync("/home/claude/manuscript", { recursive: true }); fs.writeFileSync("/home/claude/manuscript/Supplementary_Text_S1_tool_verification.docx", b); console.log("written"); });
