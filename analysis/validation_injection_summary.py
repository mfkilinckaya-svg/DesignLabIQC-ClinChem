"""Detection of an injected error of the critical size in the 2026 test period, set against the
detection requirement of each measurand (Supplementary Table S7).

Reads results/validation_injection.csv (analysis/validation_temporal.py) and reports, for an injected
error of 1.0 x the critical error (mean of the + and - directions):
  - predicted_worst_case_pct: combined Ped of the rules derived from 2025 data, analyser offset opposing the error
  - predicted_no_offset_pct:  the same error with the offset ignored
  - observed_lot_start_pct:   fraction of paired runs rejected, judged against the lot-start targets
  - observed_centred_pct:     fraction rejected with runs re-centred on the analyser mean
  - predicted_analyser_2026_cv_pct: the offset-free prediction recomputed run by run with the 2026 CV of
    the analyser that produced the run (limits stay at K x the 2025 CV). A less dispersed 2026 series
    puts less of a shifted result beyond a fixed limit, so this separates the effect of lower 2026
    imprecision from what remains (attributed to between-day variation).
  - requirement_pct and whether the observed (centred) detection met it.
Writes results/validation_injection_summary.csv."""
import math
import numpy as np, pandas as pd

REQ = {'Sodium': 90, 'Creatinine': 90, 'ALT': 70, 'Glucose': 90, 'Calcium': 90, 'TSH': 70,
       'hs-Troponin T': 90, 'Ferritin': 70, 'PSA': 70, '25-OH vitamin D': 70}
I = pd.read_csv("results/validation_injection.csv")
J = (I[I.shift_x_crit == 1.0].groupby("analyte", sort=False)
     .agg(n_runs=("n_runs", "first"), predicted_worst_case_pct=("theoretical_pct", "first"),
          predicted_no_offset_pct=("theoretical_no_offset_pct", "first"),
          observed_lot_start_pct=("empirical_pct", "mean"), observed_centred_pct=("empirical_centred_pct", "mean"))
     .reset_index())
# prediction with each analyser's 2026 CV (same run selection as validation_temporal.py)
ncdf = lambda z: 0.5 * math.erfc(-z / math.sqrt(2))
M = pd.read_csv("data/prepared/qc_measurements.csv", low_memory=False)
M = M[M.analyte.isin(list(REQ))].copy()
M["ts"] = pd.to_datetime(M.timestamp); M = M.sort_values("ts"); M["flag"] = M.instrument_flag.fillna("") != ""
M["lot_rank"] = M[M.used_for_imprecision == 1].groupby(["analyte", "level", "lot"]).cumcount()
first = M[M.lot_rank < 20].groupby(["analyte", "level", "lot"]).result.mean()
M["target"] = [first.get(k, np.nan) for k in zip(M.analyte, M.level, M.lot)]
test = M[(M.ts >= "2026-01-01") & ~(M.lot_rank < 20) & M.target.notna() & ~M.flag & (M.used_for_imprecision == 1)]
V = pd.read_csv("results/validation_temporal.csv").set_index(["analyte", "level"])
def pooled_cv(g):
    num = den = ws = n = 0
    for _, v in g.groupby("lot").result:
        if len(v) < 2: continue
        num += (len(v) - 1) * v.var(ddof=1); den += len(v) - 1; ws += v.sum(); n += len(v)
    return 100 * math.sqrt(num / den) / (ws / n)
cvi = test.groupby(["analyte", "level", "instrument"]).apply(pooled_cv, include_groups=False)
pred26 = {}
for a in REQ:
    t = test[test.analyte == a]; l1 = t[t.level == "L1"]; l2 = t[t.level == "L2"]
    pr = pd.merge_asof(l1, l2[["ts", "instrument", "result", "lot"]], on="ts", by="instrument", tolerance=pd.Timedelta("30min"),
                       direction="nearest", suffixes=("_1", "_2")).dropna(subset=["result_2"])
    crit = V.loc[(a, "L1"), "crit_error_pct"]
    def p(lv, s):
        L = V.loc[(a, lv), "K"] * V.loc[(a, lv), "cv_train"]; return 1 - (ncdf((L - crit) / s) - ncdf((-L - crit) / s))
    pred26[a] = 100 * np.mean([1 - (1 - p("L1", cvi[(a, "L1", i)])) * (1 - p("L2", cvi[(a, "L2", i)])) for i in pr.instrument])
J["predicted_analyser_2026_cv_pct"] = J.analyte.map(pred26)
J["requirement_pct"] = J.analyte.map(REQ)
J["centred_minus_no_offset_prediction"] = J.observed_centred_pct - J.predicted_no_offset_pct
J["predicted_meets_requirement"] = J.predicted_no_offset_pct >= J.requirement_pct
J["observed_meets_requirement"] = J.observed_centred_pct >= J.requirement_pct
J = J.round(1)
J.to_csv("results/validation_injection_summary.csv", index=False)
pd.set_option("display.width", 250)
print(J.to_string(index=False))
