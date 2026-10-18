"""Laboratory-specific IQC models from the control data of the ten-measurand panel (run from the repository root).
1. EWMA: average run lengths (Monte Carlo) and alarms on the data, beside the CUSUM and the 1:K rule.
2. Westgard multirule sets: false rejection per event and detection of the critical shift, by Monte Carlo, with the panel's CV.
3. Measurement uncertainty from IQC (ISO/TS 20914 style): u(Rw) from the pooled within-lot CV, U = 2*sqrt(uRw^2 + ubias^2).
4. Reagent-lot transitions: step of the analyser mean at each R1 lot change, in observed SD.
5. Control-lot start: mean of the first 20 results of a lot against the lot's final mean and the LIS target set for it.
6. Variance components per analyser: within-day and between-day CV from daily means; monthly CV.
7. Change points: binary segmentation of each analyser's standardised series.
The same algorithms are ported to the tool (tool/iqc-rule-designer-clinchem.jsx)."""
import math, numpy as np, pandas as pd
from scipy.stats import norm, ttest_ind
rng = np.random.default_rng(20261018)
M = pd.read_csv("data/prepared/qc_measurements.csv", low_memory=False)
R = pd.read_csv("results/panel_rules.csv")
M["ts"] = pd.to_datetime(M.timestamp); M["day"] = M.ts.dt.date; M["month"] = M.timestamp.str[:7]
PANEL = list(dict.fromkeys(R.analyte))
Z = 1.65

def ncdf(x): return 0.5 * math.erfc(-x / math.sqrt(2))
def inside(k, s): return ncdf(k - s) - ncdf(-k - s)

# ------------------------------------------------------------------ 1. EWMA
def ewma_arl(shift, lam, L, runs=4000, cap=20000):
    """Average run length of a two-sided EWMA with asymptotic limits ±L*sqrt(lam/(2-lam)), Monte Carlo."""
    lim = L * math.sqrt(lam / (2 - lam)); out = []
    for _ in range(runs):
        e = 0.0
        for i in range(1, cap + 1):
            e = lam * (rng.normal(shift, 1)) + (1 - lam) * e
            if abs(e) > lim: out.append(i); break
        else: out.append(cap)
    return float(np.mean(out))

def ewma_alarms(z, lam, L):
    lim = L * math.sqrt(lam / (2 - lam)); e = 0.0; n = 0
    for x in z:
        e = lam * x + (1 - lam) * e
        if abs(e) > lim: n += 1; e = 0.0
    return n

LAM, LL = 0.2, 2.86
arl_tab = [dict(model=f"EWMA lambda {LAM} L {LL}", arl0=ewma_arl(0, LAM, LL, runs=1500), arl_1sd=ewma_arl(1, LAM, LL), arl_05sd=ewma_arl(0.5, LAM, LL), arl_2sd=ewma_arl(2, LAM, LL))]
print("EWMA ARL", {k: round(v, 1) for k, v in arl_tab[0].items() if k != "model"})

# ------------------------------------------------------------------ 2. multirule simulation
def _reject(rules, hist, nl):
    z = hist[-1]
    if "13s" in rules and any(abs(v) > 3 for v in z): return True
    if "12s" in rules and any(abs(v) > 2 for v in z): return True
    if "22s" in rules:
        if all(v > 2 for v in z) or all(v < -2 for v in z): return True
        if len(hist) >= 2:
            p = hist[-2]
            if any((z[i] > 2 and p[i] > 2) or (z[i] < -2 and p[i] < -2) for i in range(nl)): return True
    if "R4s" in rules and nl >= 2 and (max(z) > 2 and min(z) < -2): return True
    if "41s" in rules:
        seq = [v for e in hist[-(4 // nl if nl else 4):] for v in e][-4:]
        if len(seq) >= 4 and (all(v > 1 for v in seq) or all(v < -1 for v in seq)): return True
        if len(hist) >= 4:
            for i in range(nl):
                col = [e[i] for e in hist[-4:]]
                if all(v > 1 for v in col) or all(v < -1 for v in col): return True
    if "10x" in rules:
        seq = [v for e in hist[-(10 // nl if nl else 10):] for v in e][-10:]
        if len(seq) >= 10 and (all(v > 0 for v in seq) or all(v < 0 for v in seq)): return True
    return False

def multirule_pfr(rules, nl, n_events=20000, warm=12):
    hist = []; rej = 0; total = 0
    for ev in range(n_events + warm):
        hist.append([rng.normal(0, 1) for _ in range(nl)]); hist = hist[-12:]
        if ev >= warm: total += 1; rej += _reject(rules, hist, nl)
    return rej / total

def multirule_ped(rules, shifts, trials=6000, warm=12):
    """Probability of rejecting the first event in which a persistent shift is present (Westgard convention),
    and of rejecting within the first two such events. Shifts in SD per level, applied to every level."""
    nl = len(shifts); first = 0; two = 0
    for _ in range(trials):
        hist = [[rng.normal(0, 1) for _ in range(nl)] for _ in range(warm)]
        hist.append([rng.normal(s, 1) for s in shifts]); r1 = _reject(rules, hist[-12:], nl)
        hist.append([rng.normal(s, 1) for s in shifts]); r2 = r1 or _reject(rules, hist[-12:], nl)
        first += r1; two += r2
    return first / trials, two / trials

SETS = {"1-2s": {"12s"}, "1-3s": {"13s"}, "1-3s/2-2s/R-4s": {"13s", "22s", "R4s"}, "1-3s/2-2s/R-4s/4-1s": {"13s", "22s", "R4s", "41s"},
        "1-3s/2-2s/R-4s/4-1s/10x": {"13s", "22s", "R4s", "41s", "10x"}}
mr = []
for a in PANEL:
    r = R[R.analyte == a].sort_values("level")
    shifts = [max(0.0, x.sigma - Z) for x in r.itertuples()]
    kd = [(1 - inside(x.k_new, 0)) for x in r.itertuples()]
    row = dict(analyte=a, crit_shift_L1=round(shifts[0], 2), crit_shift_L2=round(shifts[1], 2),
               derived_pfr=round(100 * (1 - np.prod([1 - p for p in kd])), 2),
               derived_ped=round(100 * (1 - np.prod([inside(x.k_new, s) for x, s in zip(r.itertuples(), shifts)])), 1))
    for name, rules in SETS.items():
        row[f"{name} Pfr%"] = round(100 * multirule_pfr(rules, 2, 12000), 2)
        p1, p2 = multirule_ped(rules, shifts)
        row[f"{name} Ped%"] = round(100 * p1, 1); row[f"{name} Ped2%"] = round(100 * p2, 1)
    mr.append(row); print(a, row["derived_pfr"], row["derived_ped"], row["1-3s/2-2s/R-4s/4-1s Pfr%"], row["1-3s/2-2s/R-4s/4-1s Ped%"])
pd.DataFrame(mr).to_csv("results/models_multirule.csv", index=False)

# ------------------------------------------------------------------ 3–7 per level
mu, steps, lotstart, varc, cps, ew = [], [], [], [], [], []
def binseg(z, minseg=15, thr=4.0, depth=0, offset=0, out=None):
    """Binary segmentation on a 1-D array: split where the standardised mean difference is largest, if above thr."""
    if out is None: out = []
    n = len(z)
    if n < 2 * minseg or depth > 5: return out
    best = None
    cs = np.cumsum(z); tot = cs[-1]
    for i in range(minseg, n - minseg + 1):
        m1 = cs[i - 1] / i; m2 = (tot - cs[i - 1]) / (n - i)
        stat = abs(m1 - m2) * math.sqrt(i * (n - i) / n)
        if best is None or stat > best[0]: best = (stat, i, m1, m2)
    if best and best[0] > thr:
        stat, i, m1, m2 = best
        out.append((offset + i, m2 - m1, stat))
        binseg(z[:i], minseg, thr, depth + 1, offset, out); binseg(z[i:], minseg, thr, depth + 1, offset + i, out)
    return out

for x in R.itertuples():
    d = M[(M.analyte == x.analyte) & (M.level == x.level) & (M.used_for_imprecision == 1)].sort_values("ts").copy()
    cv = x.cv / 100
    lm = d.groupby("lot").result.mean()
    d["z"] = (d.result - d.lot.map(lm)) / (cv * d.lot.map(lm))
    # 3. MU
    uRw = x.cv; ubias = x.bias
    mu.append(dict(analyte=x.analyte, level=x.level, target=x.target, uRw_pct=round(uRw, 2), ubias_analyser_pct=round(ubias, 2),
                   U_imprecision_only_pct=round(2 * uRw, 2), U_with_analyser_offset_pct=round(2 * math.sqrt(uRw**2 + ubias**2), 2)))
    # 1. EWMA on data, per analyser & lot
    nal = 0
    for (lot, ins), g in d.groupby(["lot", "instrument"]): nal += ewma_alarms(g.z.values, LAM, LL)
    ew.append(dict(analyte=x.analyte, level=x.level, n=len(d), ewma_alarms_per1000=round(1000 * nal / len(d), 1)))
    # 4. reagent-lot transitions per analyser
    for ins, g in d.groupby("instrument"):
        g = g.sort_values("ts"); lots = g.reagent_lot_r1.astype(str).values
        # a transition is the first appearance of a lot on this analyser (packs alternating on board are not transitions)
        seen = {lots[0]}; change = []
        for i in range(1, len(lots)):
            if lots[i] not in seen: seen.add(lots[i]); change.append(i)
        for c in change:
            before = g.iloc[max(0, c - 30):c]; after = g.iloc[c:c + 30]
            if len(before) < 8 or len(after) < 8: continue
            sd = cv * g.result.mean()
            step = (after.result.mean() - before.result.mean()) / sd
            p = ttest_ind(after.result, before.result, equal_var=False).pvalue
            steps.append(dict(analyte=x.analyte, level=x.level, instrument=ins, date=str(g.iloc[c].ts.date()), old_lot=lots[c - 1], new_lot=lots[c],
                              n_before=len(before), n_after=len(after), step_sd=round(step, 2), p=round(p, 4), flag=abs(step) >= 1))
    # 5. control-lot start
    for lot, g in d.groupby("lot"):
        g = g.sort_values("ts")
        if len(g) < 40: continue
        first = g.head(20).result.mean(); final = g.result.mean(); sd = cv * final
        tgt = g.head(20).target_in_force.mode().iloc[0]
        lotstart.append(dict(analyte=x.analyte, level=x.level, lot=lot, n=len(g), first20_mean=round(first, 4), final_mean=round(final, 4),
                             first20_vs_final_sd=round((first - final) / sd, 2), lis_target_at_start=tgt, lis_target_vs_final_sd=round((tgt - final) / sd, 2),
                             n_for_se_0_25sd=16, n_for_se_0_2sd=25))
    # 6. variance components per analyser (within lot, one-way by day)
    for ins, g in d.groupby("instrument"):
        parts = []
        for lot, gl in g.groupby("lot"):
            days = gl.groupby("day").result
            k = days.ngroups; N = len(gl)
            if k < 10: continue
            gm = gl.result.mean()
            ssw = sum(((v - v.mean())**2).sum() for _, v in days); dfw = N - k
            ssb = sum(len(v) * (v.mean() - gm)**2 for _, v in days); dfb = k - 1
            n0 = (N - sum(len(v)**2 for _, v in days) / N) / dfb
            msw = ssw / dfw if dfw > 0 else np.nan; msb = ssb / dfb
            sb2 = max(0.0, (msb - msw) / n0) if n0 > 0 else np.nan
            parts.append((lot, N, gm, msw, sb2))
        for lot, N, gm, msw, sb2 in parts:
            varc.append(dict(analyte=x.analyte, level=x.level, instrument=ins, lot=lot, n=N, cv_within_day=round(100 * math.sqrt(msw) / gm, 2),
                             cv_between_day=round(100 * math.sqrt(sb2) / gm, 2), cv_total=round(100 * math.sqrt(msw + sb2) / gm, 2)))
    # 7. change points per analyser (series over lots, z relative to lot mean)
    for ins, g in d.groupby("instrument"):
        g = g.sort_values("ts")
        for idx, size, stat in sorted(binseg(g.z.values)):
            cps.append(dict(analyte=x.analyte, level=x.level, instrument=ins, date=str(g.iloc[idx].ts.date()), step_sd=round(size, 2), stat=round(stat, 1),
                            r1_lot_change_within_5=bool(any(g.reagent_lot_r1.astype(str).values[max(0, idx - 5):idx + 6][1:] != g.reagent_lot_r1.astype(str).values[max(0, idx - 5):idx + 6][:-1]))))
for name, rows in [("models_mu", mu), ("models_reagent_lot_steps", steps), ("models_control_lot_start", lotstart), ("models_variance_components", varc), ("models_change_points", cps), ("models_ewma", ew)]:
    pd.DataFrame(rows).to_csv(f"results/{name}.csv", index=False)
pd.DataFrame(arl_tab).to_csv("results/models_ewma_arl.csv", index=False)
S = pd.DataFrame(steps); C = pd.DataFrame(cps); V = pd.DataFrame(varc); L = pd.DataFrame(lotstart)
print("reagent-lot transitions", len(S), "with |step|>=1 SD:", int(S.flag.sum()), "; median |step|", round(S.step_sd.abs().median(), 2))
print("change points", len(C), "of which within 5 results of an R1 lot change:", int(C.r1_lot_change_within_5.sum()))
print("variance: median within-day CV / between-day CV / total", V.cv_within_day.median(), V.cv_between_day.median(), V.cv_total.median())
print("lot start: median |first20 vs final| SD", round(L.first20_vs_final_sd.abs().median(), 2), "; LIS target vs final median |SD|", round(L.lis_target_vs_final_sd.abs().median(), 2))
print(pd.DataFrame(ew).ewma_alarms_per1000.describe())
