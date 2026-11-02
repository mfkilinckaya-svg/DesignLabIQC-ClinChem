"""
Independent verification of Ped / Pfr for Westgard-type QC rules.
Reference values for comparison with (a) Westgard QC Validator and (b) DesignLabIQC-ClinChem.

Model (Westgard power-function convention):
- Control results are z-scores ~ N(0,1) when stable.
- A systematic error dSE (in SD units) shifts ALL observations in the evaluated runs.
- N = control observations per run, R = number of runs the rules look across.
- Within-run rules (1ks, 2:2s, R4s, 2of3:2s) are applied per run;
  across-run rules (2:2s, 4:1s, 3:1s, 10x, 6x) on the consecutive sequence of N*R values.
- Critical systematic error: dSEc = (TEa - |bias|) / CV - 1.65
- Pfr = P(reject | dSE = 0); Ped = P(reject | dSE = dSEc)

Single rules are also computed in closed form:
  P(reject) = 1 - [Phi(k - dSE) - Phi(-k - dSE)]^(N*R)
"""
import numpy as np
import pandas as pd
from scipy.stats import norm

SIMS = 1_000_000
rng = np.random.default_rng(20261102)


# ---------- rule primitives (x: sims x (N*R) array of z-scores) ----------
def r_1ks(x, k, N, R):
    return (np.abs(x) > k).any(axis=1)

def _consec(mask, m):
    """True if any m consecutive True values along axis 1."""
    if mask.shape[1] < m:
        return np.zeros(mask.shape[0], bool)
    c = np.cumsum(np.pad(mask.astype(np.int32), ((0, 0), (1, 0))), axis=1)
    return ((c[:, m:] - c[:, :-m]) == m).any(axis=1)

def r_22s(x, N, R):
    # two consecutive values beyond the same 2s limit (within and across runs)
    return _consec(x > 2, 2) | _consec(x < -2, 2)

def r_R4s(x, N, R):
    # within run: one value > +2s and another < -2s
    out = np.zeros(x.shape[0], bool)
    for r in range(R):
        run = x[:, r * N:(r + 1) * N]
        out |= (run > 2).any(axis=1) & (run < -2).any(axis=1)
    return out

def r_41s(x, N, R):
    return _consec(x > 1, 4) | _consec(x < -1, 4)

def r_31s(x, N, R):
    return _consec(x > 1, 3) | _consec(x < -1, 3)

def r_10x(x, N, R):
    return _consec(x > 0, 10) | _consec(x < 0, 10)

def r_6x(x, N, R):
    return _consec(x > 0, 6) | _consec(x < 0, 6)

def r_2of3_2s(x, N, R):
    # within run (N=3): at least 2 of 3 beyond the same 2s limit
    out = np.zeros(x.shape[0], bool)
    for r in range(R):
        run = x[:, r * N:(r + 1) * N]
        out |= ((run > 2).sum(axis=1) >= 2) | ((run < -2).sum(axis=1) >= 2)
    return out


RULES = {
    "1-2s":     lambda x, N, R: r_1ks(x, 2.0, N, R),
    "1-2.5s":   lambda x, N, R: r_1ks(x, 2.5, N, R),
    "1-3s":     lambda x, N, R: r_1ks(x, 3.0, N, R),
    "1-3.5s":   lambda x, N, R: r_1ks(x, 3.5, N, R),
    "1-3s/2-2s/R-4s":
        lambda x, N, R: r_1ks(x, 3, N, R) | r_22s(x, N, R) | r_R4s(x, N, R),
    "1-3s/2-2s/R-4s/4-1s":
        lambda x, N, R: r_1ks(x, 3, N, R) | r_22s(x, N, R) | r_R4s(x, N, R) | r_41s(x, N, R),
    "1-3s/2-2s/R-4s/4-1s/10x":
        lambda x, N, R: r_1ks(x, 3, N, R) | r_22s(x, N, R) | r_R4s(x, N, R)
                        | r_41s(x, N, R) | r_10x(x, N, R),
    "1-3s/2of3-2s/R-4s/3-1s":
        lambda x, N, R: r_1ks(x, 3, N, R) | r_2of3_2s(x, N, R) | r_R4s(x, N, R) | r_31s(x, N, R),
    "1-3s/2of3-2s/R-4s/3-1s/6x":
        lambda x, N, R: r_1ks(x, 3, N, R) | r_2of3_2s(x, N, R) | r_R4s(x, N, R)
                        | r_31s(x, N, R) | r_6x(x, N, R),
}
SINGLE_K = {"1-2s": 2.0, "1-2.5s": 2.5, "1-3s": 3.0, "1-3.5s": 3.5}


def p_reject_mc(rule, N, R, dse, base):
    return RULES[rule](base + dse, N, R).mean()

def p_reject_cf(rule, N, R, dse):
    k = SINGLE_K[rule]
    return 1 - (norm.cdf(k - dse) - norm.cdf(-k - dse)) ** (N * R)


# ---------- verification grid (same as QC Validator Paket 1) ----------
CV = 2.0
scenarios = [(tea, 0.0) for tea in (4, 6, 8, 10, 12)] + [(8, 1.0), (12, 1.0)]

# (rule, N, R). Rules needing more than one run's data get R>1 (QC Validator convention).
designs = [
    ("1-2s", 2, 1), ("1-2.5s", 2, 1), ("1-3s", 2, 1), ("1-3.5s", 2, 1),
    ("1-3s/2-2s/R-4s", 2, 1),
    ("1-3s/2-2s/R-4s/4-1s", 2, 1), ("1-3s/2-2s/R-4s/4-1s", 2, 2),
    ("1-3s/2-2s/R-4s/4-1s/10x", 2, 1), ("1-3s/2-2s/R-4s/4-1s/10x", 2, 5),
    ("1-2.5s", 3, 1), ("1-3s", 3, 1),
    ("1-3s/2of3-2s/R-4s/3-1s", 3, 1),
    ("1-3s/2of3-2s/R-4s/3-1s/6x", 3, 2),
]

bases = {}
def base(N, R):
    if (N, R) not in bases:
        bases[(N, R)] = rng.standard_normal((SIMS, N * R)).astype(np.float32)
    return bases[(N, R)]

rows = []
for tea, bias in scenarios:
    sigma = (tea - abs(bias)) / CV
    dsec = sigma - 1.65
    for rule, N, R in designs:
        b = base(N, R)
        pfr = p_reject_mc(rule, N, R, 0.0, b)
        ped = p_reject_mc(rule, N, R, dsec, b)
        row = dict(TEa=tea, bias=bias, CV=CV, sigma=round(sigma, 2), dSEc=round(dsec, 2),
                   rule=rule, N=N, R=R, Pfr_MC=round(pfr, 4), Ped_MC=round(ped, 4))
        if rule in SINGLE_K:
            row["Pfr_closed"] = round(p_reject_cf(rule, N, R, 0.0), 4)
            row["Ped_closed"] = round(p_reject_cf(rule, N, R, dsec), 4)
        rows.append(row)
grid = pd.DataFrame(rows)

# ---------- power curves (dSE = 0..4) for two key rules ----------
curve_rows = []
for rule, N, R in [("1-3s", 2, 1), ("1-3s/2-2s/R-4s", 2, 1)]:
    for dse in range(5):
        r = dict(rule=rule, N=N, R=R, dSE=dse,
                 P_reject_MC=round(p_reject_mc(rule, N, R, float(dse), base(N, R)), 4))
        if rule in SINGLE_K:
            r["P_reject_closed"] = round(p_reject_cf(rule, N, R, float(dse)), 4)
        curve_rows.append(r)
curves = pd.DataFrame(curve_rows)

# MC standard error at worst case p=0.5: sqrt(0.25/1e6) = 0.0005
mc_check = grid.dropna(subset=["Ped_closed"])
max_diff = max((mc_check.Ped_MC - mc_check.Ped_closed).abs().max(),
               (mc_check.Pfr_MC - mc_check.Pfr_closed).abs().max())

with pd.ExcelWriter("results/verification_power_grid.xlsx") as w:
    grid.to_excel(w, sheet_name="Grid (Ped_Pfr)", index=False)
    curves.to_excel(w, sheet_name="Power curves", index=False)
    pd.DataFrame({
        "Note": [
            f"Monte Carlo: {SIMS:,} simulated runs per cell, seed 20261102",
            f"Max |MC - closed form| for single rules: {max_diff:.4f}",
            "dSEc = (TEa - |bias|)/CV - 1.65",
            "Rules with 4-1s / 10x / 6x shown with R=1 AND with the R needed to apply them across runs;"
            " compare with whichever R QC Validator uses.",
        ]}).to_excel(w, sheet_name="Notes", index=False)

grid.to_csv("results/verification_power_grid.csv", index=False)
curves.to_csv("results/verification_power_curves.csv", index=False)
print(grid.to_string())
print(curves.to_string())
print(f"Max |MC - closed| = {max_diff:.4f}")
