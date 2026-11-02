"""
Independent run-by-run simulation of Westgard multirules (N = 2 levels per run),
written from the rule definitions in Westgard et al., Clin Chem 1981;27:493-501,
to compare with DesignLabIQC-ClinChem (core.js: multirulePfr / multirulePed).

Convention (same as the tool, stated explicitly):
- Each run (event) has one result per control level (nl = 2), z ~ N(0,1) when stable.
- Rules are evaluated at the current run, using up to H = 12 previous runs.
- Pfr  = P(reject current run | all runs in control)           (steady state)
- Ped1 = P(reject the first run with a shift of dSE SD)         (history in control)
- Ped2 = P(reject the first OR second run with the shift)       (error persists)

Rule definitions (Westgard 1981):
  1-2s : one result beyond +/-2s
  1-3s : one result beyond +/-3s
  2-2s : two consecutive results beyond the same 2s limit -
         across materials within the run, or on the same material in consecutive runs
  R-4s : within the run only: one result > +2s and another < -2s
  4-1s : four consecutive results beyond the same 1s limit -
         across materials (current + previous run when N = 2) or within one material (4 runs)
  10x  : ten consecutive results on the same side of the mean (across materials, 5 runs when N = 2)
"""
import numpy as np, json, subprocess

SIMS = 400_000
H = 12
NL = 2
rng = np.random.default_rng(20261102)

def reject(x, rules):
    """x: (sims, runs, nl); evaluate rules at the last run."""
    z = x[:, -1, :]
    r = np.zeros(x.shape[0], bool)
    if "12s" in rules:
        r |= (np.abs(z) > 2).any(1)
    if "13s" in rules:
        r |= (np.abs(z) > 3).any(1)
    if "22s" in rules:
        r |= (z > 2).all(1) | (z < -2).all(1)                     # across materials, this run
        p = x[:, -2, :]
        r |= ((z > 2) & (p > 2)).any(1) | ((z < -2) & (p < -2)).any(1)  # same material, 2 runs
    if "R4s" in rules:
        r |= (z > 2).any(1) & (z < -2).any(1)
    if "41s" in rules:
        flat = x[:, -2:, :].reshape(x.shape[0], -1)[:, -4:]       # across materials
        r |= (flat > 1).all(1) | (flat < -1).all(1)
        col = x[:, -4:, :]                                        # within one material
        r |= ((col > 1).all(1) | (col < -1).all(1)).any(1)
    if "10x" in rules:
        flat = x[:, -5:, :].reshape(x.shape[0], -1)[:, -10:]
        r |= (flat > 0).all(1) | (flat < 0).all(1)
    return r

RULE_SETS = [
    ("1-2s", {"12s"}), ("1-3s", {"13s"}),
    ("1-3s/2-2s/R-4s", {"13s", "22s", "R4s"}),
    ("1-3s/2-2s/R-4s/4-1s", {"13s", "22s", "R4s", "41s"}),
    ("1-3s/2-2s/R-4s/4-1s/10x", {"13s", "22s", "R4s", "41s", "10x"}),
]
SHIFTS = [0.35, 1.35, 1.85, 2.35, 3.35, 3.85, 4.35]   # dSEc of the verification grid

base = rng.standard_normal((SIMS, H + 2, NL)).astype(np.float32)

out = {}
for name, rules in RULE_SETS:
    pfr = reject(base[:, :H + 1, :], rules).mean()
    se_pfr = np.sqrt(pfr * (1 - pfr) / SIMS)
    d = {"Pfr": pfr, "Pfr_se": se_pfr}
    for s in SHIFTS:
        x = base.copy()
        x[:, H:, :] += s
        r1 = reject(x[:, :H + 1, :], rules)
        r2 = r1 | reject(x[:, :H + 2, :], rules)
        d[f"Ped1_{s}"] = r1.mean()
        d[f"Ped2_{s}"] = r2.mean()
    out[name] = d

json.dump(out, open("results/verification_multirule_runbyrun.json", "w"), default=float, indent=1)
print(json.dumps(out, default=lambda v: round(float(v), 4), indent=1))
