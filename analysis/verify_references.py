"""Independent reference values for tool/test/core.test.mjs.
EWMA average run lengths by the Markov-chain method of Brook & Evans (1972) with
asymptotic limits; multirule probabilities by Monte Carlo with the rule
definitions of Westgard et al. 1981 (two levels per event). Writes
results/verification_references.json. Run from the repository root."""
import json
import numpy as np
from scipy.stats import norm

def ewma_arl(shift, lam=0.2, L=2.86, m=301):
    lim = L * np.sqrt(lam / (2 - lam)); w = 2 * lim / m
    c = -lim + w * (np.arange(m) + 0.5)
    P = np.zeros((m, m))
    for i, ci in enumerate(c):
        lo = (c - w / 2 - (1 - lam) * ci) / lam - shift; hi = (c + w / 2 - (1 - lam) * ci) / lam - shift
        P[i] = norm.cdf(hi) - norm.cdf(lo)
    arl = np.linalg.solve(np.eye(m) - P, np.ones(m))
    return float(arl[np.argmin(abs(c))])

def reject(hist, rules):
    z = hist[-1]
    if "13s" in rules and (abs(z) > 3).any(): return True
    if "12s" in rules and (abs(z) > 2).any(): return True
    if "22s" in rules:
        if (z > 2).all() or (z < -2).all(): return True
        if len(hist) >= 2:
            p = hist[-2]
            if ((z > 2) & (p > 2)).any() or ((z < -2) & (p < -2)).any(): return True
    if "R4s" in rules and (z.max() > 2 and z.min() < -2): return True
    return False

def multirule_pfr(rules, n=200000, seed=1):
    rng = np.random.default_rng(seed); hist = [rng.standard_normal(2)]; rej = 0
    for _ in range(n):
        hist.append(rng.standard_normal(2)); hist = hist[-2:]; rej += reject(hist, rules)
    return rej / n

def multirule_ped(rules, shift, n=100000, seed=2):
    rng = np.random.default_rng(seed); first = 0
    for _ in range(n):
        first += reject([rng.standard_normal(2), rng.standard_normal(2) + shift], rules)
    return first / n

out = {
    "ewma_arl0_l02_L286": ewma_arl(0), "ewma_arl_1sd_l02_L286": ewma_arl(1), "ewma_arl_05sd_l02_L286": ewma_arl(0.5),
    "multirule_pfr_13s_N2_exact": 1 - (1 - 2 * norm.sf(3)) ** 2,
    "multirule_pfr_12s_N2_exact": 1 - (1 - 2 * norm.sf(2)) ** 2,
    "multirule_pfr_13s22sR4s_N2_mc": multirule_pfr({"13s", "22s", "R4s"}),
    "multirule_ped_13s22sR4s_N2_shift2_first_mc": multirule_ped({"13s", "22s", "R4s"}, 2),
    "cusum_arl0_k05_h5_hawkins": 465.0, "cusum_arl_1sd_k05_h5_hawkins": 10.4,
}
json.dump(out, open("results/verification_references.json", "w"), indent=1)
print(json.dumps(out, indent=1))
