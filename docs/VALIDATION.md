# Verification and validation of DesignLabIQC-ClinChem

Version: tool 1.5 (October 2026; layout revised, calculations unchanged). Scope: the calculation core (`tool/core.js`), the
browser component that presents it (`tool/iqc-rule-designer-clinchem.jsx`), and the
Python analysis (`analysis/`) that produced the manuscript results. The tool is a research
prototype for designing internal quality control rules; it is not a medical device and
is not intended to release patient results. This document records what has been
verified, against what, and what has not.

## 1. Approach

Four layers, from the inside out:

| Layer | Question | Method | Where |
|---|---|---|---|
| A. Analytical | Are the formulas implemented correctly? | Fixed test cases against published values and closed-form Gaussian results | `tool/test/core.test.mjs`, sections 1–5 |
| B. Software | Does the code keep giving those answers? | Automated tests on every commit (GitHub Actions) and a written report | `.github/workflows/verify.yml`, `results/tool_verification.csv` |
| C. End-to-end | Does the tool reproduce the independent analysis on real data? | The preloaded panel (10 measurands, 20 levels, 27,963 results) computed in the tool and in Python from the same export | `results/tool_verification.csv`, section "Panel vs Python"; Supplementary Table S6 |
| D. Use | Can a laboratory scientist get the intended answer from it? | Task-based user test (planned; see §6) | — |

The calculation core was separated from the user interface so that A–C test the numbers
without a browser; the interface only formats them. Any change to the core that changes a
tested number fails the build.

## 2. Reference values (layer A)

| Quantity | Reference | Tolerance | Result |
|---|---|---|---|
| Normal CDF Φ(z), z = 0 … 5 | Abramowitz & Stegun, Table 26.1 | 1e-9 | 9/9 |
| Pfr of 1:K rules, N = 1 and 2 | Westgard et al. 1977, Table 1; exact Gaussian | 1e-6 (N=1), 1e-3 (N=2) | 6/6 |
| Ped of 1:K rules at ΔSE 1–4 SD, N = 1 and 2 | Westgard et al. 1977, Fig. 2 and Table 2 | 2e-4 (N=1), 1e-3 (N=2) | 7/7 |
| Combination over levels 1 − Π(1 − p) | definition | 1e-12 | 2/2 |
| BV tiers TEa = 1.65·kI·CVI + kB·√(CVI²+CVG²) | Fraser et al. 1997 | 0.01 % | 2/2 |
| CUSUM ARL₀ (k 0.5, h 5) and ARL at 1, 2, 0.5 SD | Hawkins & Olwell 1998 (exact 465, 10.4, 4.0, 38); tool uses Siegmund's approximation | 2 %, 0.5, 0.3, 2 | 4/4 |
| EWMA ARL₀ and ARL at 0.5 and 1 SD (λ 0.2, L 2.86) | Markov-chain ARL (Brook & Evans 1972) computed in `analysis/verify_references.py`: 371, 36.2, 9.8; Lucas & Saccucci 1990 design for ARL₀ ≈ 370 | 10 %, 4, 1 | 3/3 |
| Multirule Pfr, N = 2: 1-2s, 1-3s, 1-3s/2-2s/R-4s | exact Gaussian (0.0889, 0.0054); independent Monte Carlo 0.0094 (Westgard 1981 ≈ 0.01) | 0.01, 0.0015, 0.003 | 3/3 |
| Multirule Ped at ΔSE 2 SD, first event | independent Monte Carlo 0.418 | 0.03 | 1/1 |
| Change-point detection | synthetic step at index 60 | ±1 | 1/1 |
| Edge cases | missing CV, bias > TEa, per-level convention | behavioural | 3/3 |

Two reference values first written into the test file were wrong and were caught by the
independent computation: the EWMA design λ 0.2 / L 2.86 has ARL₀ ≈ 370, not 500, and
the multirule first-event detection at 2 SD is 0.42, not 0.52. The tool was right in both
cases; the test file was corrected and the Python reference script added so that the
references are reproducible.

## 3. Tool versus Python on the study panel (layer C)

For the ten measurands of the manuscript the tool and `analysis/rule_search.py` agree on:
sigma at every level (20/20, tolerance 0.02), the critical error in per cent (10/10,
0.01), the combined detection (10/10, 0.1 percentage point) and false rejection (10/10,
0.01 point) of the adopted rules, and the rule search itself: started from K = 3 at both
levels with the "best combined detection" strategy, the tool returns the same K pair as
Python for every measurand (10/10). The two implementations share no code: Python uses
`scipy.stats.norm`, the tool its own erfc from the incomplete gamma function.

## 4. What is not verified here

- The importer (cobas infinity CSV parsing, test-code mapping, Excel serial dates) is
  exercised by the Playwright demo script (`videos/make_demo*.py`) but has no unit tests
  yet; the figures it produces for ALT were checked by hand against the Python CV.
- The measurement-uncertainty block reproduces ISO/TS 20914 formulas; no external worked
  example has been compared.
- Variance components (within-/between-day) are checked only for internal consistency.
- Browser rendering, persistence (localStorage) and export are not tested automatically.
- Nothing here validates that the derived rules improve patient outcomes; the
  retrospective evaluation in the manuscript is the only outcome-level evidence.

## 5. How to run

```
npm test                              # 17 tests, writes results/tool_verification.csv
python3 analysis/verify_references.py # regenerates the independent EWMA/multirule references
```

## 6. Planned user test (layer D)

Task: given one cobas infinity export, state the target and SD to enter in the LIS for
sodium L2 and the expected detection of the critical error. Participants: 3–5 biomedical
laboratory scientists not involved in development. Measures: completion, time, errors,
System Usability Scale. To be repeated after the layout revision of October 2026.

## 7. Sources

Abramowitz M, Stegun IA. Handbook of mathematical functions. 1964. · Westgard JO et al.
Clin Chem 1977;23:1857–67. · Westgard JO et al. Clin Chem 1981;27:493–501. · Fraser CG
et al. Ann Clin Biochem 1997;34:8–12. · Hawkins DM, Olwell DH. Cumulative sum charts
and charting for quality improvement. Springer; 1998. · Lucas JM, Saccucci MS.
Technometrics 1990;32:1–12. · Brook D, Evans DA. Biometrika 1972;59:539–49. · Siegmund
D. Sequential analysis. Springer; 1985.
