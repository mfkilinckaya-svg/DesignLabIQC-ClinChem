# Clinical chemistry and immunochemistry IQC rule design from laboratory imprecision

Data, code and tool for the planned manuscript

> *Deriving clinical chemistry and immunoassay control rules from laboratory imprecision: the allowable-error source decides what is attainable* (in preparation).

This is the companion to the haematology study
([DesignLabIQC](https://github.com/mfkilinckaya-svg/DesignLabIQC), [doi:10.5281/zenodo.22685381](https://doi.org/10.5281/zenodo.22685381)).
The method and the calculation engine are the same. What changes is the platform, the panel, the control material and the allowable-error sources.

The central claim is the same as in the haematology study. Internal quality control rules should be derived from the imprecision a laboratory actually measures, with the target taken from its own pooled analyser mean, not from assigned ranges. For several analytes, whether a rule looks attainable at all depends more on the chosen allowable-error source than on the analyser.

**Status:** work in progress. The tool and the data-preparation script are usable. Data for the full panel, the analysis scripts and the results will be added as the study proceeds.

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
| `tool/` | **`iqc-rule-designer-clinchem.html`**: single-file browser tool, no installation, no network. It opens with the ten-analyte panel at two control levels. Targets come from the LIS. CV and allowable total error are left empty, except creatinine, which is pre-filled from the study period. `iqc-rule-designer-clinchem.jsx` is the source. `build/` rebuilds the HTML from the source. |
| `analysis/` | **`cobas_qc_prepare.py`**: turns cobas infinity QC exports into the study data set and the tool's import file, and writes a data-quality report. |
| `docs/` | `DATA_DICTIONARY.md`: the columns of the prepared data set. |
| `data/` | Prepared control-result data (to be deposited). |

## Differences from the haematology tool

- **Two control levels per analyte**, renumbered by ascending target (L1 = low, L2 = high). The original control names (for example "ClinChem 2" and "ClinChem 3") are kept in the data set.
- **Allowable total error is entered, not preset.** Each card has an *Allowable error sources* row where a named source and its value can be added (Labquality, Noklus, CLIA, Rili-BÄK, Turkey MoH 2026, EFLM or Ricos biological variation, or any other label). Every source entered appears in the *Same measurement, different specification* comparison. Entering CVI and CVG still adds the three Fraser tiers automatically.
- **Incomplete analytes are not flagged as failing.** Until a CV and an allowable error are present, a card shows what is missing instead of red verdicts.
- **Import adds analytes it does not know.** Results for an analyte that is not in the panel create a new card under *Imported*. In the haematology tool such rows were skipped. This lets the whole platform (around 70 analytes) be loaded at once.
- **Raw cobas infinity exports can be imported directly.** The tool reads the `Test`, `Control`, `Control lot`, `Instrument` and `Result` columns. Calibration records (empty `Control`) are skipped. Results the LIS rejected (`Review = Rejected`) are left out of the imprecision estimate, and the number left out is reported.
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

Open `tool/iqc-rule-designer-clinchem.html` in a browser. For each analyte:

1. Add the allowable-error sources.
2. Load `tool_import.csv` (or a raw cobas export) with **Import results**. This sets each level's CV to the pooled within-lot CV of the worst analyser, the target to the pooled mean of all analysers, and the bias to the largest analyser offset from that target.
3. Read off sigma, critical shift, false rejection and detection.
4. **Search for rules** to find the K per level that keeps the combined false rejection within the allowance while meeting the detection target.

**Export CSV** writes the rules and the SD to enter in the LIS. Work is saved in the browser on that device only.

To evaluate the LIS target instead of the pooled mean, overwrite the target in the level row.

## Rebuilding the tool

```bash
cd tool/build
npm install
./build.sh ../iqc-rule-designer-clinchem.jsx ../iqc-rule-designer-clinchem.html "IQC rule designer — clinical chemistry"
```

## Licence

Code (`analysis/`, `tool/`): MIT. Data, figures and documents: CC BY 4.0. See `LICENSE`.
