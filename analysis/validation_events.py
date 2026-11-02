"""Documented events: do the control results move when the analyser is recalibrated or the reagent lot
changes, and which rule signals the move?

Events (May 2025 - June 2026, 10 measurands): calibrations from cobas infinity
(data/prepared/calibration_events.csv; lot calibration LC, cassette calibration CC, calculated AC,
failed FC, rejected by operator RC) and reagent lot (R1) changes per analyser from the control export.
For every event and level on the analyser concerned:
  step = mean of the next 5 accepted control results - mean of the previous 5, in % of the lot target
  (prospective lot target = mean of the first 20 accepted results of the control lot, as in
  validation_temporal.py), and in SD units (SD = worst-analyser pooled within-lot CV, whole period).
A step counts as relevant when |step| >= half the critical systematic error of the measurand
(results/validation_temporal.csv). For relevant steps: did the first run after the event (either level)
reject under (a) the derived rule (K per level from validation_temporal.csv, centre = lot target) and
(b) the LIS rule in force (target and SD defined in the LIS, 1-3s)?
Writes results/validation_events.csv and results/validation_events_summary.csv; monthly means relative
to the lot target for glucose, hs-troponin T and 25-OH vitamin D go to results/validation_monthly.csv."""
import numpy as np, pandas as pd

PANEL = ['Sodium', 'Creatinine', 'ALT', 'Glucose', 'Calcium', 'TSH', 'hs-Troponin T', 'Ferritin', 'PSA', '25-OH vitamin D']
W = 5

M = pd.read_csv("data/prepared/qc_measurements.csv", low_memory=False)
M = M[M.analyte.isin(PANEL)].copy()
M["ts"] = pd.to_datetime(M.timestamp)
M = M.sort_values("ts")
M["lot_rank"] = M[M.used_for_imprecision == 1].groupby(["analyte", "level", "lot"]).cumcount()
first = M[M.lot_rank < 20].groupby(["analyte", "level", "lot"]).result.mean()
M["target"] = [first.get(k, np.nan) for k in zip(M.analyte, M.level, M.lot)]
V = pd.read_csv("results/validation_temporal.csv").set_index(["analyte", "level"])
CRIT = V.groupby(level=0).crit_error_pct.first()

# events
C = pd.read_csv("data/prepared/calibration_events.csv", parse_dates=["timestamp"])
C = C[C.event_type.isin(["LC", "CC", "AC", "FC", "RC"])][["analyte", "instrument", "timestamp", "event_type"]]
lots = []
for (a, ins), g in M[M.reagent_lot_r1.notna()].groupby(["analyte", "instrument"]):
    g = g.sort_values("ts"); ch = g.reagent_lot_r1.astype(str).ne(g.reagent_lot_r1.astype(str).shift())
    for ts in g.ts[ch].iloc[1:]: lots.append(dict(analyte=a, instrument=ins, timestamp=ts, event_type="R1 lot"))
E = pd.concat([C, pd.DataFrame(lots)], ignore_index=True).sort_values("timestamp")
# a cassette calibration of the ISE recurs many times a day; keep events at least 12 h apart per analyser and type
E["gap"] = E.groupby(["analyte", "instrument", "event_type"]).timestamp.diff()
E = E[E.gap.isna() | (E.gap >= pd.Timedelta("12h"))].drop(columns="gap")

out = []
for e in E.itertuples():
    q = M[(M.analyte == e.analyte) & (M.instrument == e.instrument)]
    good = q[q.used_for_imprecision == 1]
    rec = dict(analyte=e.analyte, instrument=e.instrument, timestamp=e.timestamp, event_type=e.event_type)
    steps = []
    for lv in ("L1", "L2"):
        gl = good[good.level == lv]
        pre = gl[gl.ts < e.timestamp].tail(W); post = gl[gl.ts >= e.timestamp].head(W)
        if len(pre) < W or len(post) < W or post.lot.iloc[0] != pre.lot.iloc[-1]:
            rec[f"step_{lv}_pct"] = np.nan; continue
        tgt = pre.target.iloc[-1]; cv = V.loc[(e.analyte, lv), "cv_train"]
        s = 100 * (post.result.mean() - pre.result.mean()) / tgt
        rec[f"step_{lv}_pct"] = round(s, 3); rec[f"step_{lv}_sd"] = round(s / cv, 2); steps.append(abs(s))
    if not steps: continue
    rec["max_step_pct"] = max(steps); rec["crit_pct"] = CRIT[e.analyte]
    rec["relevant"] = max(steps) >= 0.5 * CRIT[e.analyte]
    # first run after the event: both levels within 30 min of the first post-event result
    post_all = q[q.ts >= e.timestamp].head(6)
    if len(post_all):
        t0 = post_all.ts.iloc[0]; run = post_all[post_all.ts <= t0 + pd.Timedelta("30min")]
        K = run.level.map(lambda lv: V.loc[(e.analyte, lv), "K"]); cvr = run.level.map(lambda lv: V.loc[(e.analyte, lv), "cv_train"]) / 100
        rec["derived_rejects_first_run"] = bool(((run.result - run.target).abs() > K * cvr * run.target).any())
        rec["lis_rejects_first_run"] = bool(((run.result - run.target_in_force).abs() > 3 * run.sd_defined_in_lis).any())
    out.append(rec)
O = pd.DataFrame(out)
O.to_csv("results/validation_events.csv", index=False)

S = O.groupby("event_type").agg(events=("analyte", "size"), relevant=("relevant", "sum"),
                                 median_abs_step_pct=("max_step_pct", "median")).reset_index()
R = O[O.relevant]
S = S.merge(R.groupby("event_type").agg(derived_detects=("derived_rejects_first_run", "sum"),
                                        lis_detects=("lis_rejects_first_run", "sum")).reset_index(), how="left", on="event_type").fillna(0)
S.to_csv("results/validation_events_summary.csv", index=False)
pd.set_option("display.width", 220)
print(S.to_string(index=False))
print("\nrelevant steps by measurand:")
print(R.groupby(["analyte", "event_type"]).agg(n=("max_step_pct", "size"), median_step=("max_step_pct", "median"),
      derived=("derived_rejects_first_run", "sum"), lis=("lis_rejects_first_run", "sum")).to_string())
print("\nall events, first run rejects:", O.derived_rejects_first_run.mean().round(3), "(derived)", O.lis_rejects_first_run.mean().round(3), "(LIS)")

# monthly means relative to the lot target, accepted results, all analysers
G = M[(M.used_for_imprecision == 1) & M.analyte.isin(["Glucose", "hs-Troponin T", "25-OH vitamin D", "ALT"])].copy()
G["dev_pct"] = 100 * (G.result - G.target) / G.target
Mo = G.groupby(["analyte", "level", G.ts.dt.to_period("M").astype(str)]).dev_pct.mean().round(2).unstack(0)
Mo.to_csv("results/validation_monthly.csv")
print(Mo.to_string())

# ---------------------------------------------------------------------------------------------
# Detection by the size of the error the event left behind. The step above compares the five
# results after an event with the five before; a step can also bring results back towards the
# target. What the rule is designed to catch is a deviation FROM THE TARGET, so here an event
# counts when the mean of the five accepted results after it sits at least a given fraction of
# the critical error away from the lot target while the five before it did not, and detection
# is read within one, two and three runs after the event (a run = both levels within 30 min).
# Writes results/validation_events_detection.csv.
from scipy.stats import beta, fisher_exact
def ci95(k, n):
    return (beta.ppf(0.025, k, n - k + 1) if k > 0 else 0.0, beta.ppf(0.975, k + 1, n - k) if k < n else 1.0)
det_rows = []
for e in E.itertuples():
    q = M[(M.analyte == e.analyte) & (M.instrument == e.instrument)]; good = q[q.used_for_imprecision == 1]
    post_dev, pre_dev = [], []
    for lv in ("L1", "L2"):
        gl = good[good.level == lv]; pre = gl[gl.ts < e.timestamp].tail(W); post = gl[gl.ts >= e.timestamp].head(W)
        if len(pre) < W or len(post) < W or post.lot.iloc[0] != pre.lot.iloc[-1]: continue
        post_dev.append(100 * abs(post.result.mean() - post.target.iloc[0]) / post.target.iloc[0])
        pre_dev.append(100 * abs(pre.result.mean() - pre.target.iloc[-1]) / pre.target.iloc[-1])
    if not post_dev: continue
    qq = q[q.ts >= e.timestamp].head(12); runs = []
    for _, r in qq.iterrows():
        if runs and (r.ts - runs[-1][-1].ts) <= pd.Timedelta("30min"): runs[-1].append(r)
        else: runs.append([r])
    rec = dict(analyte=e.analyte, instrument=e.instrument, timestamp=e.timestamp, event_type=e.event_type,
               post_dev_pct=round(max(post_dev), 3), pre_dev_pct=round(max(pre_dev), 3), crit_pct=CRIT[e.analyte])
    for n in (1, 2, 3):
        d = l = False
        for run in runs[:n]:
            for r in run:
                K = V.loc[(e.analyte, r.level), "K"]; cv = V.loc[(e.analyte, r.level), "cv_train"] / 100
                d |= abs(r.result - r.target) > K * cv * r.target
                l |= abs(r.result - r.target_in_force) > 3 * r.sd_defined_in_lis
        rec[f"derived_within_{n}"] = d; rec[f"lis_within_{n}"] = l
    det_rows.append(rec)
D = pd.DataFrame(det_rows)
D.to_csv("results/validation_events_deviation.csv", index=False)
summ = []
for frac in (0.5, 1.0):
    sel = D[(D.post_dev_pct >= frac * D.crit_pct) & (D.pre_dev_pct < frac * D.crit_pct)]
    for n in (1, 2, 3):
        kd, kl = int(sel[f"derived_within_{n}"].sum()), int(sel[f"lis_within_{n}"].sum())
        summ.append(dict(error_after_event=f">= {frac} x critical error", events=len(sel), within_runs=n,
                         derived=kd, derived_pct=round(100 * kd / len(sel), 1) if len(sel) else None,
                         derived_ci95=f"{100*ci95(kd,len(sel))[0]:.0f}-{100*ci95(kd,len(sel))[1]:.0f}" if len(sel) else "",
                         lis=kl, lis_pct=round(100 * kl / len(sel), 1) if len(sel) else None,
                         lis_ci95=f"{100*ci95(kl,len(sel))[0]:.0f}-{100*ci95(kl,len(sel))[1]:.0f}" if len(sel) else "",
                         fisher_p=round(fisher_exact([[kd, len(sel) - kd], [kl, len(sel) - kl]])[1], 3) if len(sel) else None))
S2 = pd.DataFrame(summ); S2.to_csv("results/validation_events_detection.csv", index=False)
print("\nDetection by the error left behind (deviation from target):"); print(S2.to_string(index=False))
sel = D[(D.post_dev_pct >= D.crit_pct) & (D.pre_dev_pct < D.crit_pct)]
print(sel.groupby("analyte").agg(n=("derived_within_1", "size"), d1=("derived_within_1", "sum"), d3=("derived_within_3", "sum"), l1=("lis_within_1", "sum"), l3=("lis_within_3", "sum")).to_string())
# reagent-lot steps (step definition): derived vs LIS, first run, with CI
rl = O[O.relevant & (O.event_type == "R1 lot")]
kd, kl, n = int(rl.derived_rejects_first_run.sum()), int(rl.lis_rejects_first_run.sum()), len(rl)
print(f"\nReagent-lot steps >= half the critical error: n={n}, derived {kd} ({100*ci95(kd,n)[0]:.0f}-{100*ci95(kd,n)[1]:.0f}%), LIS {kl} ({100*ci95(kl,n)[0]:.0f}-{100*ci95(kl,n)[1]:.0f}%), Fisher p={fisher_exact([[kd,n-kd],[kl,n-kl]])[1]:.3f}")
