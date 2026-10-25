# Clinical chemistry and immunochemistry IQC rule design from laboratory imprecision

Data, code and tool for the planned manuscript

> *Deriving clinical chemistry and immunoassay control rules from laboratory imprecision: the allowable-error source decides what is attainable* (in preparation).

This is the companion to the haematology study
([DesignLabIQC](https://github.com/mfkilinckaya-svg/DesignLabIQC), [doi:10.5281/zenodo.22685381](https://doi.org/10.5281/zenodo.22685381)).
The method and the calculation engine are the same. What changes is the platform, the panel, the control material and the allowable-error sources.

The central claim is the same as in the haematology study. Internal quality control rules should be derived from the imprecision a laboratory actually measures, with the target taken from its own pooled analyser mean, not from assigned ranges. For several analytes, whether a rule looks attainable at all depends more on the chosen allowable-error source than on the analyser.

**Status:** data collection, allowable-error sources and rule selection for the ten-analyte panel are complete (October 2026). Retrospective false-rejection analysis and the manuscript follow.

## Setting

| | |
|---|---|
| Platform | Roche cobas pro: two c 703 photometric units, an integrated ISE module (sodium, potassium, chloride), two e 801 immunoassay units (Roche Diagnostics, Mannheim, Germany) |
| Control material | Sero (Billingstad, Norway), two levels per analyte |
| Period | 1 May 2025 – 30 June 2026 |
| Panel in the manuscript | Sodium, creatinine, ALT, glucose, calcium (clinical chemistry); TSH, hs-troponin T, ferritin, PSA, 25-OH vitamin D (immunochemistry) |
| Supplementary | The remaining quantitative analytes on the platform |

## What is here

| Folder | Content |
|---|---|
| `tool/` | **`iqc-rule-designer-clinchem.html`**: single-file browser tool, no installation, no network. It opens with the ten-analyte panel at two control levels, pre-filled from 1 May 2025 – 30 June 2026: CV of the worst analyser (pooled within lot), target (mean of the control lot in use at the end of the period), largest analyser offset, every allowable-error source collected for the analyte, EFLM CVI/CVG, the source chosen by the hierarchy and the K per level found by the rule search. `iqc-rule-designer-clinchem.jsx` is the source; `build/` rebuilds the HTML (`preload_panel.py` writes the panel values into the source). |
| `analysis/` | **`cobas_qc_prepare.py`**: turns cobas infinity QC exports into the study data set and the tool's import file, and writes a data-quality report. **`tool_values.py`**: per analyte and level, the CV, target and analyser offset the tool uses. **`rule_search.py`**: applies the source hierarchy (most stringent traceable source with sigma ≥ 3 at every level and a rule set within the false-rejection allowance that meets the detection requirement) and the tool's rule search to the panel. **`lis_compare.py`**: the chosen rules against the SD currently defined in the LIS. **`patch_tool.py`**: writes sources, biological-variation inputs and chosen rules into the tool's starting panel. Run all three from the repository root. |
| `docs/` | `DATA_DICTIONARY.md`: the columns of the prepared data set. |
| `data/` | `TEa_sources_clinical_chemistry.xlsx`: allowable-error sources per analyte (Labquality, CLIA, Rili-BÄK, Noklus, RCPA, China WS/T 403-2024, SEKK Dmax, Belgium WIV-ISP, Turkey MoH 2026, EFLM and Ricos biological variation) with the measured CV, target and analyser offset and the resulting sigma per level. `prepared/tool_values_by_level.csv`: per analyte and level, the values the tool uses. Control-result data to be deposited. |
| `results/` | `panel_rules.csv`: for the ten-analyte panel, the chosen allowable-error source, sigma, K per level, the SD to enter in the LIS and the current LIS SD. `rule_search_results.json`: every source tried per analyte with its sigma and best rule set. |

## Differences from the haematology tool

- **Two control levels per analyte**, renumbered by ascending target (L1 = low, L2 = high). The original control names (for example "ClinChem 2" and "ClinChem 3") are kept in the data set.
- **Allowable total error is entered, not preset.** Each card has an *Allowable error sources* row where a named source and its value can be added (Labquality, Noklus, CLIA, Rili-BÄK, Turkey MoH 2026, EFLM or Ricos biological variation, or any other label). Every source entered appears in the *Same measurement, different specification* comparison. Entering CVI and CVG still adds the three Fraser tiers automatically.
- **Incomplete analytes are not flagged as failing.** Until a CV and an allowable error are present, a card shows what is missing instead of red verdicts.
- **Import adds analytes it does not know.** Results for an analyte that is not in the panel create a new card under *Imported*. In the haematology tool such rows were skipped. This lets the whole platform (around 70 analytes) be loaded at once.
- **Raw cobas infinity exports can be imported directly.** The tool reads the `Test`, `Control`, `Control lot`, `Instrument` and `Result` columns, and the `Target value` and `SD` columns when present (the latest pair per level is kept as the LIS entry in force). Calibration records (empty `Control`) are skipped. Results the LIS rejected (`Review = Rejected`) are left out of the imprecision estimate, and the number left out is reported.
- **What to enter in the LIS — now and recommended.** Each card compares the target and SD currently entered in the LIS (imported or typed) with the pooled lot mean and the derived SD: the current rule expressed in measured SD, its false-alarm and detection probabilities at the adopted allowable error, the change in SD and the shift of the target. The same columns are in the CSV export.
- **CUSUM.** Each card has a tabular CUSUM (Page 1954): a design table comparing average run lengths of the CUSUM (k, h adjustable) with the card's 1:K rules at shifts of 0.5–3 SD (Siegmund's approximation), and, once results with a date column are imported, one chart per analyser with alarms, the alarm rate per 1000 results against the expected rate, and a choice of centre (pooled lot mean, analyser lot mean, card target). Imported result series are kept for the session only. `analysis/cusum.py` runs the same CUSUM on the prepared data set.
- **More from the same data** (per card, collapsed): EWMA chart and run lengths; Westgard multirule sets evaluated on the measured SD by simulation; measurement uncertainty from IQC (ISO/TS 20914); reagent-lot transitions and control-lot starts; within-day and between-day CV; change points by binary segmentation. `analysis/iqc_models.py` runs the same estimates on the prepared data set (results/models_*.csv).
- **Raw exports are read as text** (dd/mm/yyyy dates are not re-read as mm/dd), and the study laboratory's cobas infinity test codes are mapped to the panel names.
- **Separate browser storage.** The tool saves under its own key, so it does not overwrite the haematology tool's saved work when both are opened from the same site.

## Preparing the data

Export QC results from cobas infinity as semicolon-separated CSV, one file per analyte and period (both analysers and both levels in one file). The export is capped at 2 000 rows. A file with exactly 2 000 rows has been cut off and should be split into shorter periods.

```bash
pip install pandas numpy
python3 analysis/cobas_qc_prepare.py data/raw/ data/prepared/
```

Outputs:

| File | Content |
|---|---|
| `qc_measurements.csv` | All control results with the LIS decision (`lis_rejected`), the target and SD in force, and the z-score against that target |
| `tool_import.csv` | Accepted results only; load with **Import results** |
| `cv_by_instrument.csv`, `cv_worst_instrument.csv` | Pooled within-lot CV, mean and bias against the LIS target, per analyser and for the worst analyser |
| `rejections.csv` | LIS-rejected results with their z-score |
| `qc_report.md` | Coverage and gaps per analyser, lots and LIS targets, imprecision, rejections, drift of the mean against the target by quarter |

Imprecision uses accepted results only. The retrospective false-rejection analysis uses all control results.

## Using the tool

Open `tool/iqc-rule-designer-clinchem.html` in a browser. It has three layers:

1. **Overview** — the whole panel on one screen, one row per measurand: adopted source, sigma, critical error, K per level, false rejection, detection and the target ± SD to enter in the LIS. **Search all** re-derives every rule; **Export CSV** writes the table. Click a row to open it.
2. **Rule design** — one measurand at a time, chosen from the list on the left. The strip under the header gives the answer (source, rule, sigma, critical error, false rejection, detection, LIS entry, what the current LIS rule detects). Four tabs below it: *Rule* (false-alarm budget, level table with CV/target/offset/K, rule search, power curves), *Allowable error sources* (sources and the same-measurement comparison), *LIS and limits* (what to enter now versus recommended, the imprecision you can afford), *Monitoring* (CUSUM, EWMA, multirule, measurement uncertainty, reagent-lot steps, change points).
3. **Settings** (collapsed by default), **Maker ranges** and **Method and references**.

To fill a measurand from data, load `tool_import.csv` or a raw cobas infinity export with **Import results**: each level's CV becomes the pooled within-lot CV of the worst analyser, the target the pooled lot mean, the offset the largest analyser deviation. Work is saved in the browser on that device only.

## Verification

The calculation core (`tool/core.js`) is tested against published power functions and run lengths, exact Gaussian values, an independent Markov-chain/Monte Carlo computation and the Python analysis of the study panel: `npm test` (17 tests, 92 comparisons, report in `results/tool_verification.csv`). See `docs/VALIDATION.md`.

## Rebuilding the tool

```bash
cd tool/build
npm install
./build.sh ../iqc-rule-designer-clinchem.jsx ../iqc-rule-designer-clinchem.html "IQC rule designer — clinical chemistry"
```

## Licence

Code (`analysis/`, `tool/`): MIT. Data, figures and documents: CC BY 4.0. See `LICENSE`.
