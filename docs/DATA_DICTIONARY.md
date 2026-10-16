# Data dictionary

## `qc_measurements.csv`

One row per control measurement, produced by `analysis/cobas_qc_prepare.py` from cobas infinity QC exports. Calibration records are removed. Exact duplicates from overlapping export windows are removed. No patient data and no operator identifiers are included.

| Column | Type | Meaning |
|---|---|---|
| `analyte` | text | Analyte name as used in the manuscript (mapped from `test_code`; unmapped codes are kept as they are). |
| `test_code` | text | Test code in the LIS (cobas infinity `Test`), e.g. `S-Kreat`. |
| `unit` | text | Reporting unit. |
| `timestamp` | ISO datetime | Time the control was measured. |
| `instrument` | text | Analyser module and cobas pro unit, e.g. `c703-1`, `c703-2`, `e801-1`. Derived from cobas infinity `Instrument`. |
| `level` | L1 / L2 | Control level, numbered by ascending target within the analyte. |
| `control_name` | text | Control name in the LIS, e.g. `ClinChem 2`, `IMMUN L1`. |
| `lot` | text | Control lot number. |
| `result` | number | Measured value in `unit`. |
| `target_in_force` | number | Target value the LIS was using for this measurement. |
| `sd_defined_in_lis` | number | SD the LIS was using for this measurement. |
| `lis_limit_low`, `lis_limit_high` | number | Target ± 2 SD (LIS). |
| `z_vs_target` | number | (result − target_in_force) / sd_defined_in_lis. |
| `lis_rule_outcome` | text | Westgard rule outcome as reported by the LIS, verbatim (e.g. `Warning 1x2s`, `Error 1x2s,1xKs(3)`). |
| `lis_qc_status` | text | QC status as reported by the LIS. |
| `lis_masked` | 0/1 | 1 if the QC status carries `Masked`. In the creatinine data this occurs on every row from one analyser and no row from the other, so it is treated as an analyser attribute and not as an exclusion. |
| `lis_review` | Accepted / Rejected | Review decision in the LIS. |
| `lis_rejected` | 0/1 | 1 if `lis_review` is `Rejected`. These rows are excluded from imprecision and kept for the false-rejection analysis. |
| `instrument_flag` | text | Instrument notification codes other than N (normal), 48/49 (QC range) and 71 (potential carry-over, a run-order notice), e.g. 43 calibration abnormal, 47 calibration invalid, 18 ISE noise, 120 expired ISE electrode, 123 ISE on-board stability exceeded. Empty if none. |
| `excluded_reason` | text | Reason a whole analyte level was excluded from imprecision after review (see `EXCLUDED_LEVELS` in the script). Empty if not excluded. |
| `used_for_imprecision` | 0/1 | 1 if the result was accepted by the LIS, carries no instrument flag and its level is not excluded after review. Imprecision uses these rows only. Accepted results with QC status `Error` are kept; their effect is reported as a sensitivity CV. |
| `bottle_status` | text | Control bottle status (`Current`, `Standby`). |
| `reagent_lot_r1` | text | Reagent lot (R1). |
| `source_file` | text | Export file the row came from. |
