"""Tabular CUSUM on the panel's control results (run from the repository root).
Standardised with the level's worst-analyser CV; one chart per analyser and lot; k = 0.5, h = 4 and 5.
Alarm rates by centre (pooled lot mean, analyser lot mean, analyser monthly mean) and average run lengths."""
import math, numpy as np, pandas as pd
M = pd.read_csv("data/prepared/qc_measurements.csv", low_memory=False)
R = pd.read_csv("results/panel_rules.csv")
M["month"] = M.timestamp.str[:7]
K = 0.5
def arl(shift, k, h):  # Siegmund, one-sided
    d = shift - k; b = h + 1.166
    return b * b if abs(d) < 1e-9 else (math.exp(-2 * d * b) + 2 * d * b - 1) / (2 * d * d)
def run(z, k, h):
    cp = cn = 0; alarms = 0; runs = []; r = 0
    for x in z:
        cp = max(0, cp + x - k); cn = max(0, cn - x - k); r += 1
        if cp > h or cn > h: alarms += 1; runs.append(r); cp = cn = 0; r = 0
    return alarms, runs
rows = []
for x in R.itertuples():
    d = M[(M.analyte == x.analyte) & (M.level == x.level) & (M.instrument_flag.fillna("") == "")].sort_values("timestamp").copy()
    good = d[d.used_for_imprecision == 1]
    lm = good.groupby("lot").result.mean(); im = good.groupby(["lot", "instrument"]).result.mean(); mm = good.groupby(["lot", "instrument", "month"]).result.mean()
    centres = {"pooled_lot_mean": d.lot.map(lm), "analyser_lot_mean": pd.Series([im.get((l, i), np.nan) for l, i in zip(d.lot, d.instrument)], index=d.index),
               "analyser_month_mean": pd.Series([mm.get((l, i, m), np.nan) for l, i, m in zip(d.lot, d.instrument, d.month)], index=d.index)}
    out = dict(analyte=x.analyte, level=x.level, n=len(d), rule_alarms_per1000=1000 * (abs((d.result - centres["pooled_lot_mean"]) / (x.cv / 100 * centres["pooled_lot_mean"])) > x.k_new).mean())
    for h in (4, 5):
        for name, c in centres.items():
            z = ((d.result - c) / (x.cv / 100 * c)).fillna(0)
            alarms = 0; runs = []
            for _, g in z.groupby([d.lot, d.instrument]):
                a, r = run(g.values, K, h); alarms += a; runs += r
            out[f"cusum_h{h}_{name}_per1000"] = 1000 * alarms / len(d)
            if name == "pooled_lot_mean": out[f"cusum_h{h}_median_run"] = np.median(runs) if runs else np.nan
        out[f"cusum_h{h}_expected_per1000"] = 1000 / (arl(0, K, h) / 2)
    rows.append(out)
T = pd.DataFrame(rows); T.to_csv("results/cusum_panel.csv", index=False)
pd.set_option("display.width", 250); print(T.round(1).to_string(index=False))
w = T.n
for c in [c for c in T.columns if c.endswith("per1000")]: print(f"{c:45s} {(T[c] * w).sum() / w.sum():6.1f}")
