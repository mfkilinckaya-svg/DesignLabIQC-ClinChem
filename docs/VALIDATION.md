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
| Multirule Pfr and Ped run by run, 5 rule sets, ΔSE 1.35/2.35/3.35 | independent simulation `analysis/verify_multirule_runbyrun.py` (Westgard 1981 definitions, 400,000 sequences) | 0.0015 (Pfr), 0.01 (Ped) | 35/35 |
| Values stated by Westgard: Pfr of 1-2s at N = 1–6; 1-3s shift at Ped 0.50; 1-3s at 3.4 SD | Westgard & Groth 1979; Westgard et al. 1981 | 0.02; 0.1 SD; ≥ 0.90 | 7/7 |
| Normalized OPSpecs x-intercepts, N = 2 | Westgard online OPSpecs charts (read) | 0.6 | 6/6 |
| Laboratory QC design spreadsheet, 36 rows × 5 outputs | spreadsheet in routine use (`data/verification/lab_design_spreadsheet_rows.csv`) | 1e-12 | 1/1 |
| Change-point detection | synthetic step at index 60 | ±1 | 1/1 |
| Edge cases | missing CV, bias > TEa, per-level convention | behavioural | 3/3 |

Two reference values first written into the test file were wrong and were caught by the
independent computation: the EWMA design λ 0.2 / L 2.86 has ARL₀ ≈ 370, not 500, and
the multirule first-event detection at 2 SD is 0.42, not 0.52. The tool was right in both
cases; the test file was corrected and the Python reference script added so that the
references are reproducible.

## 2b. Further comparators (November 2026)

No commercial QC design program (QC Validator, EZ Rules) was available, so four
comparators that share no code with the tool were added:

1. **The laboratory's own QC design spreadsheet.** All 36 analyte-level rows (inputs and the
   values the spreadsheet computed: sigma, critical shift, Pfr, Ped, action limit) were given to
   `computeLevel` with the per-level convention. Largest difference 4.4 × 10⁻¹⁶. A review of the
   spreadsheet formulas found no error.
2. **Westgard's published values.** 1-2s as a rejection rule rejects about 5, 10, 14, 18 and 26 %
   of runs at N = 1, 2, 3, 4, 6 (Westgard et al. 1981): tool 4.6, 8.9, 13.0, 17.0, 24.4 %. 1-3s at
   N = 2 detects a 2.5 SD shift with probability 0.50 (Westgard & Groth 1979): tool 2.46 SD.
3. **Normalized OPSpecs charts** (Westgard online, N = 2 at 90 % and 50 % AQA; N = 3 at 90 %): the
   x-intercepts computed from the tool agree with the charts within reading precision, and the
   order of the rule lines is the same in every chart. Westgard's legend for N = 3 gives Pfr 0.14
   and 0.03 for 1-2s and 1-2.5s; the exact values are 0.130 and 0.037.
4. **Full multirule grid, run by run.** An independent simulation written from the rule definitions
   of Westgard et al. 1981 (`analysis/verify_multirule_runbyrun.py`) and the tool agree on all 75
   values (5 rule sets; Pfr; Ped at the first run and within two runs at seven shifts): largest
   difference 0.0022, all |z| ≤ 2.0. Values from programs that evaluate an R-run window in which all
   runs are shifted differ for rules using earlier runs (4-1s, 10x); the convention must be stated.
5. **Importer, end to end.** Westgard's online QC calculator example (20 values) was imported as one
   lot and as two lots of 10 (`data/verification/westgard_example_import.csv`): mean 199.55 and CV
   2.098 % (one lot), pooled within-lot CV 2.096 % (two lots), identical to the calculator and to an
   independent calculation.

`analysis/verify_power_grid.py` gives the closed-form and window-convention reference grid
(CV 2 %, TEa 4–12 %, bias 0 and 1 %, 13 rule designs) used for these comparisons.

Known difference: the tool applies 10x across levels only (five runs at N = 2); Westgard et al.
1981 also allow it within one level.

## 3. Tool versus Python on the study panel (layer C)

For the ten measurands of the manuscript the tool and `analysis/rule_search.py` agree on:
sigma at every level (20/20, tolerance 0.02), the critical error in per cent (10/10,
0.01), the combined detection (10/10, 0.1 percentage point) and false rejection (10/10,
0.01 point) of the adopted rules, and the rule search itself: started from K = 3 at both
levels with the "best combined detection" strategy, the tool returns the same K pair as
Python for every measurand (10/10). The two implementations share no code: Python uses
`scipy.stats.norm`, the tool its own erfc from the incomplete gamma function.

## 4. What is not verified here

- The importer (cobas infinity CSV parsing, test-code mapping, Excel serial dates) has no unit
  tests; it is exercised by the Playwright demo script (`videos/make_demo*.py`), the ALT figures
  were checked by hand against the Python CV, and the Westgard example (§2b, item 5) was
  imported end to end with the expected mean and pooled CV.
- The measurement-uncertainty block reproduces ISO/TS 20914 formulas; no external worked
  example has been compared.
- Variance components (within-/between-day) are checked only for internal consistency.
- Browser rendering, persistence (localStorage) and export are not tested automatically.
- Nothing here validates that the derived rules improve patient outcomes; the
  retrospective evaluation in the manuscript is the only outcome-level evidence.

## 5. How to run

```
npm test                              # 21 tests, writes results/tool_verification.csv
python3 analysis/verify_references.py # regenerates the independent EWMA/multirule references
python3 analysis/verify_multirule_runbyrun.py  # independent run-by-run multirule simulation
python3 analysis/verify_power_grid.py          # closed-form / window-convention reference grid
```

## 6. Planned user test (layer D)

Task: given one cobas infinity export, state the target and SD to enter in the LIS for
sodium L2 and the expected detection of the critical error. Participants: 3–5 biomedical
laboratory scientists not involved in development. Measures: completion, time, errors,
System Usability Scale. To be repeated after the layout revision of October 2026.

## 7. Sources

Abramowitz M, Stegun IA. Handbook of mathematical functions. 1964. · Westgard JO et al.
Clin Chem 1977;23:1857–67. · Westgard JO et al. Clin Chem 1981;27:493–501. · Westgard JO, Groth T.
Clin Chem 1979;25:863–9. · Westgard JO, Groth T. Clin Chem 1981;27:1536–45. · Westgard QC.
Normalized OPSpecs charts and Online QC Calculator (westgard.com, accessed 2 Nov 2026). · Fraser CG
et al. Ann Clin Biochem 1997;34:8–12. · Hawkins DM, Olwell DH. Cumulative sum charts
and charting for quality improvement. Springer; 1998. · Lucas JM, Saccucci MS.
Technometrics 1990;32:1–12. · Brook D, Evans DA. Biometrika 1972;59:539–49. · Siegmund
D. Sequential analysis. Springer; 1985.
