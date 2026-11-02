"""Supplementary tables S1-S7 from the current results, plus the two derived tables that were
previously produced by hand.

1. results/supplementary_S1_imprecision_all_levels.csv: every control level of every measurand
   (data/prepared/tool_values_by_level.csv) with the CV defined in the LIS (SD in force / target in
   force, last lot) and the ratio observed/defined.
2. results/sigma_cvi_cv.csv: TEa-free sigma of Oosterhuis and Coskun, CVI/CV, for the panel
   (CVI from the EFLM database as recorded in the TEa workbook).
3. results/Supplementary_Tables_S1-S7.xlsx: one workbook, one sheet per table, a README sheet first.

Run after analysis/tool_values.py, rule_search.py, lis_compare.py, retrospective.py, iqc_models.py,
convention_comparison.py, sensitivity_eqa_bias.py, validation_temporal.py, validation_events.py and
validation_injection_summary.py."""
import collections, json
import openpyxl, pandas as pd
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter

PANEL = ['Sodium', 'Creatinine', 'ALT', 'Glucose', 'Calcium', 'TSH', 'hs-Troponin T', 'Ferritin', 'PSA', '25-OH vitamin D']
XL = "data/TEa_sources_clinical_chemistry.xlsx"

# ---- 1. S1: imprecision of all levels
T = pd.read_csv("data/prepared/tool_values_by_level.csv")
T["cv_defined"] = 100 * T.lis_sd_in_lot / T.lis_target_in_lot
T["ratio"] = T.cv / T.cv_defined
S1 = T.drop(columns=[c for c in ("cv_precise", "bias_precise") if c in T])
S1.to_csv("results/supplementary_S1_imprecision_all_levels.csv", index=False)

# ---- TEa per measurand x source (same reading as rule_search.py)
wb = openpyxl.load_workbook(XL, data_only=True)
TEA = collections.defaultdict(dict)
for r in wb["For the tool"].iter_rows(min_row=5):
    v = [c.value for c in r]
    if v[0] and v[3] not in (None, ""): TEA[v[0]][v[2]] = float(v[3])

# ---- 2. CVI/CV for the panel; CVI is the EFLM value recorded in the TEa input sheet (row 5 header "CVI %")
inp = wb["TEa input"]
cvi_col = next(c.column for c in inp[5] if c.value == "CVI %")
CVI = {str(r[0].value).strip(): float(r[cvi_col - 1].value) for r in inp.iter_rows(min_row=6)
       if r[0].value and isinstance(r[cvi_col - 1].value, (int, float))}
P = T[T.analyte.isin(PANEL)][["analyte", "level", "cv"]].copy()
P["cvi_pct"] = P.analyte.map(CVI)
P["sigma_cvi_cv"] = (P.cvi_pct / P.cv).round(2)
P["cv_needed_for_4_65"] = (P.cvi_pct / 4.65).round(2)
P["analyte"] = pd.Categorical(P.analyte, PANEL); P = P.sort_values(["analyte", "level"])
P.to_csv("results/sigma_cvi_cv.csv", index=False)

# ---- S2: TEa and sigma by source for every measurand with a percentage source
rows = []
for a, g in T.groupby("analyte"):
    g = g.sort_values("level")
    for src, tea in sorted(TEA.get(a, {}).items(), key=lambda kv: kv[1]):
        r = dict(analyte=a, source=src, tea_pct=tea)
        for x in g.itertuples():
            r[f"sigma_{x.level}"] = round((tea - abs(x.bias)) / x.cv, 2)
        r["sigma_3_at_every_level"] = all(r[f"sigma_{x.level}"] >= 3 for x in g.itertuples())
        rows.append(r)
S2 = pd.DataFrame(rows)
refs = pd.DataFrame(wb["References"].iter_rows(min_row=4, values_only=True)).dropna(how="all")
refs = refs.iloc[:, :6]; refs.columns = ["Source", "Version / year", "Citation", "URL", "Access date", "Note"]

# ---- S3: every source tried per panel measurand
R = json.load(open("results/rule_search_results.json"))
s3 = []
for o in R:
    for r in o["rows"]:
        b = r.get("best") or {}
        s3.append(dict(analyte=o["analyte"], source=r["source"], tea_pct=round(r["tea"], 2),
                       sigma_L1=round(r["sigma"][0], 2), sigma_L2=round(r["sigma"][1], 2),
                       K_L1=(b.get("ks") or [None, None])[0], K_L2=(b.get("ks") or [None, None])[1],
                       combined_pfr_pct=round(100 * b["pfr"], 2) if b else None,
                       combined_ped_pct=round(100 * b["ped"], 1) if b else None,
                       adopted=bool(o["chosen"]) and o["chosen"]["source"] == r["source"]))
S3 = pd.DataFrame(s3)

csv = lambda f: pd.read_csv("results/" + f)
SHEETS = [
    ("S1 Imprecision all levels", S1, "Supplementary Table S1. Imprecision (pooled within-lot CV of the worst analyser), target, analyser offset, LIS-defined CV and the ratio observed/defined for all 133 control levels of the 63 quantitative measurands, 1 May 2025 - 30 June 2026."),
    ("S2a TEa and sigma by source", S2, "Supplementary Table S2a. Allowable total error (%) by measurand and source, with the sigma of every level, (TEa - |offset|)/CV."),
    ("S2b EQA-bias sensitivity", csv("eqa_bias_sensitivity.csv"), "Supplementary Table S2b. Sigma and critical error of the panel with the median EQA deviation in place of the analyser offset."),
    ("S2c CVI-CV sigma", P, "Supplementary Table S2c. TEa-free sigma CVI/CV (Oosterhuis and Coskun) for the panel."),
    ("S2d Source references", refs, "Supplementary Table S2d. Citation and version of every TEa source."),
    ("S3 Rule search", S3, "Supplementary Table S3. Every source tried per panel measurand, with its sigma and the best rule set within the 1.5% false-rejection allowance."),
    ("S4a Multirule", csv("models_multirule.csv"), "Supplementary Table S4a. Westgard multirule sets on the observed SD (Monte Carlo)."),
    ("S4b EWMA", csv("models_ewma.csv"), "Supplementary Table S4b. EWMA charts per analyser and lot."),
    ("S4c EWMA ARL", csv("models_ewma_arl.csv"), "Supplementary Table S4c. EWMA average run lengths."),
    ("S4d CUSUM", csv("cusum_panel.csv"), "Supplementary Table S4d. CUSUM alarm rates."),
    ("S4e Measurement uncertainty", csv("models_mu.csv"), "Supplementary Table S4e. Measurement uncertainty (ISO/TS 20914)."),
    ("S4f Reagent-lot steps", csv("models_reagent_lot_steps.csv"), "Supplementary Table S4f. Step of each analyser's mean at the first use of a new reagent lot."),
    ("S4g Control-lot start", csv("models_control_lot_start.csv"), "Supplementary Table S4g. Deviation of a control lot's first 20 results from its final mean."),
    ("S4h Variance components", csv("models_variance_components.csv"), "Supplementary Table S4h. Within-day and between-day CV."),
    ("S4i Change points", csv("models_change_points.csv"), "Supplementary Table S4i. Change points by binary segmentation."),
    ("S5 Conventions", csv("convention_comparison.csv"), "Supplementary Table S5. Combined detection of the adopted rules under four ways of sizing the critical error: A each level at its own critical shift; B Westgard's equal shift in SD; C one per-cent error with the offset opposing it (used in the study); D the same error with the offset ignored."),
    ("S6 Tool verification", csv("tool_verification.csv"), "Supplementary Table S6. Verification of the tool's calculation core (141 comparisons)."),
    ("S7a Temporal validation", csv("validation_temporal.csv"), "Supplementary Table S7a. Rules derived from May-December 2025 applied to January-June 2026, per level."),
    ("S7b Injected errors", csv("validation_injection.csv"), "Supplementary Table S7b. Detection of injected errors of 0.5, 1.0 and 1.5 times the critical error, both directions."),
    ("S7c Injection vs requirement", csv("validation_injection_summary.csv"), "Supplementary Table S7c. Detection of an injected critical error against the worst-case, offset-free and 2026-CV predictions and the detection requirement."),
    ("S7d Event detection", csv("validation_events_detection.csv"), "Supplementary Table S7d. Detection of documented events by the error they left relative to the target, within one to three runs, with Clopper-Pearson 95% CIs and Fisher's exact test."),
    ("S7e Event summary", csv("validation_events_summary.csv"), "Supplementary Table S7e. Documented events by type: relevant steps and first-run detection."),
    ("S7f Events", csv("validation_events.csv"), "Supplementary Table S7f. Every documented calibration and reagent-lot event with the step it caused."),
    ("S7g Monthly means", csv("validation_monthly.csv"), "Supplementary Table S7g. Monthly mean deviation from the lot target for glucose, ALT, hs-TnT and 25-OH vitamin D (%)."),
]

out = "results/Supplementary_Tables_S1-S7.xlsx"
with pd.ExcelWriter(out, engine="openpyxl") as xw:
    pd.DataFrame({"Sheet": [s for s, _, _ in SHEETS], "Content": [t for _, _, t in SHEETS]}).to_excel(xw, "README", index=False)
    for name, df, title in SHEETS:
        df.to_excel(xw, sheet_name=name[:31], index=False, startrow=2)
        xw.sheets[name[:31]]["A1"] = title
wb = openpyxl.load_workbook(out)
for ws in wb.worksheets:
    for row in ws.iter_rows():
        for c in row:
            c.font = Font(name="Arial", size=10, bold=c.font.bold)
    hdr = 1 if ws.title == "README" else 3
    for c in ws[hdr]:
        c.font = Font(name="Arial", size=10, bold=True); c.fill = PatternFill("solid", fgColor="DDE4EE")
    if ws.title != "README":
        ws["A1"].font = Font(name="Arial", size=11, bold=True)
        ws.freeze_panes = "A4"
    for i, col in enumerate(ws.iter_cols(min_row=hdr, max_row=min(ws.max_row, 200)), 1):
        w = max(len(str(c.value)) if c.value is not None else 0 for c in col)
        ws.column_dimensions[get_column_letter(i)].width = min(max(10, w + 2), 60 if ws.title == "README" else 28)
    if ws.title == "README":
        for c in ws["B"]: c.alignment = Alignment(wrap_text=True, vertical="top")
        ws.column_dimensions["B"].width = 110
wb.save(out)
print("written", out, len(SHEETS), "sheets")
