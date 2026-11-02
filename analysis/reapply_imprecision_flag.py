"""One-off: re-derive `used_for_imprecision` in data/prepared/qc_measurements.csv under the
policy of cobas_qc_prepare.py (results the LIS accepted with QC status "Error" are excluded).
Kept so that the prepared file can be regenerated without the raw exports, which are not in
the repository. Run from the repository root."""
import pandas as pd
p = "data/prepared/qc_measurements.csv"
M = pd.read_csv(p, low_memory=False)
mask = (M.used_for_imprecision == 1) & M.lis_qc_status.astype(str).str.startswith("Error")
M.loc[mask, "used_for_imprecision"] = 0
M.to_csv(p, index=False)
print("accepted Error-status results removed from imprecision:", int(mask.sum()))
