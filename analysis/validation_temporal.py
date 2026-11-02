"""Validation of the derived rules on data not used to derive them.

Design
- Training period: 1 May - 31 Dec 2025. Test period: 1 Jan - 30 Jun 2026.
- From training data only, per measurand and level: pooled within-lot CV of the worst analyser
  (accepted, unflagged results), and the worst analyser offset from the pooled lot mean (% of target).
  The rule (K per level) is then searched exactly as in analysis/rule_search.py: one critical error per
  measurand (TEa - max_i(|offset_i| + 1.65 CV_i)), combined false rejection <= 1.5 %, best combined detection.
  TEa per measurand = the source adopted in results/panel_rules.csv.
- Prospective targets, as the laboratory does for a new control lot: target = mean of the first 20
  accepted results of the lot (all analysers). Those 20 results are not evaluated. SD = training CV x target.
- (1) Temporal split: predicted Pfr per level, 1 - [Phi(K) - Phi(-K)], against the observed fraction of
  test results beyond target +/- K SD. Instrument-flagged results are reported separately. CV stability:
  training CV against the same statistic in the test period.
- (2) Error injection: test-period runs (L1 and L2 on the same analyser within 30 min) are shifted by a
  known systematic error (0.5, 1.0 and 1.5 x the critical error, in % of the target) and the fraction of
  runs in which at least one level rejects is compared with the theoretical combined Ped: with the
  training offset taken to oppose the error (the study's convention, for runs judged against the
  lot-start target) and with the offset ignored (for runs re-centred on the analyser mean).
Writes results/validation_temporal.csv and results/validation_injection.csv."""
import math, itertools
import numpy as np, pandas as pd

TRAIN_END = "2026-01-01"
PANEL = ['Sodium', 'Creatinine', 'ALT', 'Glucose', 'Calcium', 'TSH', 'hs-Troponin T', 'Ferritin', 'PSA', '25-OH vitamin D']
PFR_BUDGET = 0.015; Z = 1.65; K_GRID = [v / 10 for v in range(15, 51)]; N_TARGET = 20

ncdf = lambda z: 0.5 * math.erfc(-z / math.sqrt(2))
inside = lambda k, s: ncdf(k - s) - ncdf(-k - s)
pfr1 = lambda k: 1 - inside(k, 0)
ped1 = lambda k, s: 0.0 if s <= 0 else 1 - inside(k, s)
combine = lambda ps: 1 - np.prod([1 - p for p in ps])

def search(levels, tea):
    crit = tea - max(abs(b) + Z * cv for cv, b in levels)
    shifts = [max(0.0, (crit - abs(b)) / cv) for cv, b in levels]
    best = None
    for ks in itertools.product(K_GRID, repeat=len(levels)):
        pf = combine([pfr1(k) for k in ks])
        if pf > PFR_BUDGET + 1e-12: continue
        cp = combine([ped1(k, s) for k, s in zip(ks, shifts)])
        score = cp * 1000 - pf
        if best is None or score > best["score"]:
            best = dict(score=score, ks=ks, pfr=pf, ped=cp, crit=crit, shifts=shifts)
    return best

def pooled_cv(g):
    """pooled within-lot CV of one analyser"""
    num = den = wsum = n = 0
    for _, v in g.groupby("lot").result:
        if len(v) < 2: continue
        num += (len(v) - 1) * v.var(ddof=1); den += len(v) - 1; wsum += v.sum(); n += len(v)
    return 100 * math.sqrt(num / den) / (wsum / n) if den else np.nan

def level_stats(d):
    good = d[d.used_for_imprecision == 1]
    cvs = {i: pooled_cv(g) for i, g in good.groupby("instrument")}
    worst = max(cvs, key=lambda i: cvs[i])
    offs = []
    for lot, g in good.groupby("lot"):
        m = g.result.mean()
        offs += [abs(gi.result.mean() - m) / m * 100 for _, gi in g.groupby("instrument") if len(gi) >= 10]
    return cvs[worst], (max(offs) if offs else 0.0), worst

M = pd.read_csv("data/prepared/qc_measurements.csv", low_memory=False)
M = M[M.analyte.isin(PANEL)].copy()
M["ts"] = pd.to_datetime(M.timestamp)
M["flag"] = M.instrument_flag.fillna("") != ""
TEA = pd.read_csv("results/panel_rules.csv").groupby("analyte").tea.first()

# prospective lot targets: first 20 accepted results of each lot (all analysers, time order)
M = M.sort_values("ts")
M["lot_rank"] = M[M.used_for_imprecision == 1].groupby(["analyte", "level", "lot"]).cumcount()
first = M[M.lot_rank < N_TARGET].groupby(["analyte", "level", "lot"]).result.mean()
M["target"] = [first.get((a, l, t), np.nan) for a, l, t in zip(M.analyte, M.level, M.lot)]
M["in_target_set"] = M.lot_rank < N_TARGET

train = M[M.ts < TRAIN_END]; test = M[M.ts >= TRAIN_END]

rows, inj = [], []
for a in PANEL:
    st = {lv: level_stats(train[(train.analyte == a) & (train.level == lv)]) for lv in ("L1", "L2")}
    st_test = {lv: level_stats(test[(test.analyte == a) & (test.level == lv)]) for lv in ("L1", "L2")}
    levels = [(st[lv][0], st[lv][1]) for lv in ("L1", "L2")]
    best = search(levels, float(TEA[a]))
    for i, lv in enumerate(("L1", "L2")):
        cv, off, worst = st[lv]; K = best["ks"][i]
        t = test[(test.analyte == a) & (test.level == lv) & ~test.in_target_set & test.target.notna()]
        rej = (t.result - t.target).abs() > K * cv / 100 * t.target
        g = t[t.used_for_imprecision == 1]
        c_pool = t.lot.map(g.groupby("lot").result.mean())
        c_inst = pd.Series([g.groupby(["lot", "instrument"]).result.mean().get((l, i), np.nan) for l, i in zip(t.lot, t.instrument)], index=t.index).fillna(c_pool)
        rej_pool = (t.result - c_pool).abs() > K * cv / 100 * c_pool
        rej_inst = (t.result - c_inst).abs() > K * cv / 100 * c_inst
        mean_dev = 100 * ((g.result - g.target) / g.target).mean()   # accepted, unflagged results only
        rows.append(dict(analyte=a, level=lv, tea=float(TEA[a]), cv_train=round(cv, 3), cv_test=round(st_test[lv][0], 3),
                         offset_train_pct=round(off, 3), offset_test_pct=round(st_test[lv][1], 3), K=K,
                         n_test=len(t), n_flagged=int(t.flag.sum()),
                         pfr_predicted_pct=round(100 * pfr1(K), 3),
                         rej_observed_pct=round(100 * rej.mean(), 3),
                         rej_observed_unflagged_pct=round(100 * rej[~t.flag].mean(), 3),
                         rej_centre_test_lot_mean_pct=round(100 * rej_pool[~t.flag].mean(), 3),
                         rej_centre_test_analyser_mean_pct=round(100 * rej_inst[~t.flag].mean(), 3),
                         mean_deviation_from_target_pct=round(mean_dev, 3),
                         combined_pfr_pct=round(100 * best["pfr"], 3), combined_ped_pct=round(100 * best["ped"], 2),
                         crit_error_pct=round(best["crit"], 3)))
    # error injection on paired runs
    t = test[(test.analyte == a) & ~test.in_target_set & test.target.notna() & ~test.flag & (test.used_for_imprecision == 1)]
    l1 = t[t.level == "L1"].sort_values("ts"); l2 = t[t.level == "L2"].sort_values("ts")
    pr = pd.merge_asof(l1, l2[["ts", "instrument", "result", "target", "lot"]], on="ts", by="instrument",
                       tolerance=pd.Timedelta("30min"), direction="nearest", suffixes=("_1", "_2")).dropna(subset=["result_2"])
    K1, K2 = best["ks"]; cv1, cv2 = st["L1"][0] / 100, st["L2"][0] / 100
    gi = t.groupby(["lot", "instrument", "level"]).result.mean()
    pr["c1"] = [gi.get((l, i, "L1"), np.nan) for l, i in zip(pr.lot_1, pr.instrument)]
    pr["c2"] = [gi.get((l, i, "L2"), np.nan) for l, i in zip(pr.lot_2, pr.instrument)]
    for mult in (0.0, 0.5, 1.0, 1.5):
        e = mult * max(best["crit"], 0) / 100      # systematic error, fraction of the target
        for sign in (+1, -1):
            x1 = pr.result_1 + sign * e * pr.target_1; x2 = pr.result_2 + sign * e * pr.target_2
            r = ((x1 - pr.target_1).abs() > K1 * cv1 * pr.target_1) | ((x2 - pr.target_2).abs() > K2 * cv2 * pr.target_2)
            y1 = pr.result_1 + sign * e * pr.c1; y2 = pr.result_2 + sign * e * pr.c2
            ri = ((y1 - pr.c1).abs() > K1 * cv1 * pr.c1) | ((y2 - pr.c2).abs() > K2 * cv2 * pr.c2)
            s = [mult * sh for sh in best["shifts"]]
            theo = combine([pfr1(K1), pfr1(K2)]) if mult == 0 else combine([ped1(K1, s[0]), ped1(K2, s[1])])
            # the same error with the offset ignored (runs centred on the analyser mean carry no offset)
            theo_no = combine([pfr1(K1), pfr1(K2)]) if mult == 0 else combine([ped1(K1, mult * max(best["crit"], 0) / st["L1"][0]), ped1(K2, mult * max(best["crit"], 0) / st["L2"][0])])
            # same model with the test-period SD of the worst analyser (limits stay at K x training SD)
            def p_out(K, cv_tr, cv_te, e_pct):
                lim = K * cv_tr; return 1 - (ncdf((lim - e_pct) / cv_te) - ncdf((-lim - e_pct) / cv_te))
            e_pct = 100 * e
            theo_te = combine([p_out(K1, st["L1"][0], st_test["L1"][0], e_pct), p_out(K2, st["L2"][0], st_test["L2"][0], e_pct)])
            inj.append(dict(analyte=a, shift_x_crit=mult, direction="+" if sign > 0 else "-", n_runs=len(pr),
                            empirical_pct=round(100 * r.mean(), 2), empirical_centred_pct=round(100 * ri.mean(), 2),
                            theoretical_pct=round(100 * theo, 2), theoretical_no_offset_pct=round(100 * theo_no, 2), theoretical_test_cv_pct=round(100 * theo_te, 2)))

R = pd.DataFrame(rows); I = pd.DataFrame(inj)
R.to_csv("results/validation_temporal.csv", index=False); I.to_csv("results/validation_injection.csv", index=False)
pd.set_option("display.width", 250)
print(R[["analyte", "level", "cv_train", "cv_test", "K", "n_test", "pfr_predicted_pct", "rej_observed_unflagged_pct", "rej_centre_test_lot_mean_pct", "rej_centre_test_analyser_mean_pct", "mean_deviation_from_target_pct"]].to_string(index=False))
w = R.n_test
for c in ["pfr_predicted_pct", "rej_observed_pct", "rej_observed_unflagged_pct", "rej_centre_test_lot_mean_pct", "rej_centre_test_analyser_mean_pct"]:
    print("Overall %s: %.2f%%" % (c, (R[c] * w).sum() / w.sum()))
J = I.groupby(["analyte", "shift_x_crit"]).agg(practice=("empirical_pct", "mean"), centred=("empirical_centred_pct", "mean"), theory=("theoretical_pct", "first"), theory_no_offset=("theoretical_no_offset_pct", "first"), theory_test_cv=("theoretical_test_cv_pct", "first")).round(1)
print(J.unstack().to_string())
print(I.pivot_table(index="analyte", columns=["shift_x_crit", "direction"], values="empirical_pct").round(1).to_string())
print(I[I.direction == "+"].pivot_table(index="analyte", columns="shift_x_crit", values="theoretical_pct").round(1).to_string())
