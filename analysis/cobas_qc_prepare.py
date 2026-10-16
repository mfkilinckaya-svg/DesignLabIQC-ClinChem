#!/usr/bin/env python3
"""
cobas_qc_prepare.py — Roche cobas infinity QC export(s) -> DesignLabIQC input files.

Reads every *.csv in a folder (semicolon-separated cobas infinity QC export, 27 columns),
merges them, removes calibration rows and duplicates, maps columns to the DesignLabIQC
schema and writes:

  out/qc_measurements.csv      all control measurements, full schema (deposit file, same
                               columns as the haematology study's data dictionary + extras)
  out/tool_import.csv          Accepted results only, 5 columns -> load into
                               iqc-rule-designer.html (analyte, level, lot, instrument, result)
  out/cv_by_instrument.csv     pooled within-lot CV, mean, bias vs LIS target, per
                               analyte x level x instrument
  out/cv_worst_instrument.csv  the highest-CV instrument per analyte x level (carried forward)
  out/rejections.csv           LIS-rejected rows with z-score vs target in force
  out/qc_report.md             data-quality report (coverage, truncation, lots, exclusions)

Decisions (protocol v2, agreed 16/10/2026):
  * Rows with an empty `Control` are calibration records ("Rules not defined"; LC/ILC/CC/IIC/FC
    notifications) and are excluded.
  * Imprecision (CV) and means use Review == "Accepted" only.
  * False-rejection analysis uses all control rows; `lis_rejected` flags the LIS decision.
  * CV is computed within lot and pooled across lots (sum of (n-1)*SD^2), as in the
    haematology study; the worst instrument is carried forward.
  * Control levels are renumbered per analyte by ascending target: L1 = lowest, L2 = next.
    The original control name is kept in `control_name`.
  * The `Masked` part of QC status occurs on every CPRO_2 row and on no CPRO_1 row, so it is
    an instrument-level attribute, not an exclusion flag; it is kept as `lis_masked`.

Usage:  python3 cobas_qc_prepare.py raw/ out/
"""
import sys, re, glob, os
import numpy as np
import pandas as pd

TRUNCATION_LIMIT = 2000          # cobas infinity export row cap

# Test code -> (manuscript name, unit). Extend as new analytes are exported.
ANALYTES = {
    "S-Kreat":   ("Creatinine", "µmol/L"),
    "S-ALAT":    ("ALT", "U/L"),
    "S-ALT":     ("ALT", "U/L"),
    "S-Glukose": ("Glucose", "mmol/L"),
    "S-Glu":     ("Glucose", "mmol/L"),
    "S-Ca":      ("Calcium", "mmol/L"),
    "S-Kalsium": ("Calcium", "mmol/L"),
    "S-Na":      ("Sodium", "mmol/L"),
    "S-K":       ("Potassium", "mmol/L"),
    "S-Cl":      ("Chloride", "mmol/L"),
    "S-Natrium": ("Sodium", "mmol/L"),
    "S-TSH":     ("TSH", "mIU/L"),
    "S-TnT":     ("hs-Troponin T", "ng/L"),
    "S-Ferritin":("Ferritin", "µg/L"),
    "S-PSA":     ("PSA", "µg/L"),
    "S-D25":     ("25-OH vitamin D", "nmol/L"),
}


def short_instrument(s: str) -> str:
    """'SNR_CPRO_1 - c703-2402-09-1' -> 'c703-1'; falls back to the raw string."""
    m = re.search(r"CPRO_(\d+)\s*-\s*([A-Za-z]+\d*)", s)
    return f"{m.group(2)}-{m.group(1)}" if m else s.strip()


def num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.str.replace(",", ".", regex=False), errors="coerce")


def load(path: str) -> pd.DataFrame:
    d = pd.read_csv(path, sep=";", dtype=str, encoding="utf-8-sig").fillna("")
    d.columns = [c.strip() for c in d.columns]
    d = d.apply(lambda c: c.str.strip())
    d["source_file"] = os.path.basename(path)
    d["file_rows"] = len(d)
    return d


def pooled_cv(g: pd.DataFrame) -> pd.Series:
    ss = 0.0; dof = 0; wsum = 0.0; nsum = 0
    for _, gl in g.groupby("lot"):
        v = gl["result"].dropna().values
        if len(v) < 2:
            continue
        s = v.std(ddof=1)
        ss += (len(v) - 1) * s * s; dof += len(v) - 1
        wsum += len(v) * v.mean(); nsum += len(v)
    if dof == 0:
        return pd.Series({"n": nsum, "mean": np.nan, "sd": np.nan, "cv": np.nan})
    sd = np.sqrt(ss / dof); mean = wsum / nsum
    return pd.Series({"n": nsum, "mean": mean, "sd": sd, "cv": 100 * sd / mean})


def main(src: str, out: str) -> None:
    os.makedirs(out, exist_ok=True)
    files = sorted(glob.glob(os.path.join(src, "*.csv")))
    if not files:
        sys.exit(f"No CSV files in {src}")
    raw = pd.concat([load(f) for f in files], ignore_index=True)
    rep = ["# QC export report", "", f"Files read: {len(files)}", ""]
    rep += ["| File | Rows | Truncated? |", "|---|---|---|"]
    for f, n in raw.groupby("source_file")["file_rows"].first().items():
        rep.append(f"| {f} | {n} | {'**YES — split this export**' if n >= TRUNCATION_LIMIT else 'no'} |")

    # --- calibration rows -------------------------------------------------------
    is_cal = raw["Control"] == ""
    cal = raw[is_cal]
    rep += ["", f"Raw rows: {len(raw)}  |  calibration rows removed: {len(cal)}"]
    if len(cal):
        rep += ["", "Calibration notifications removed:", ""]
        for k, v in cal["Notifications"].value_counts().items():
            rep.append(f"- {k}: {v}")

    d = raw[~is_cal].copy()
    d["timestamp"] = pd.to_datetime(d["Date"], format="%d/%m/%Y %H:%M:%S", errors="coerce")
    bad_ts = d["timestamp"].isna().sum()
    d["result"] = num(d["Result"])
    d["target_in_force"] = num(d["Target value"])
    d["sd_defined_in_lis"] = num(d["SD"])
    # Short names; when two units share a cobas pro and module (the ISE module has two
    # units per cobas pro), keep the unit suffix so they are not merged.
    raw_ins = d["Instrument"].drop_duplicates()
    short = {r: short_instrument(r) for r in raw_ins}
    clash = pd.Series(short).duplicated(keep=False)
    for r in raw_ins:
        if clash[r]:
            m = re.search(r"-(\d+)\s*$", r)
            short[r] = f"{short[r]}.{m.group(1)}" if m else r.strip()
    d["instrument"] = d["Instrument"].map(short)
    d["test_code"] = d["Test"]
    d["analyte"] = d["Test"].map(lambda t: ANALYTES.get(t, (t, ""))[0])
    d["unit"] = d.apply(lambda r: r["Unit"] or ANALYTES.get(r["Test"], ("", ""))[1], axis=1)
    d["control_name"] = d["Control"]
    d["lot"] = d["Control lot"]

    # --- duplicates (overlapping export windows) --------------------------------
    key = ["test_code", "instrument", "control_name", "lot", "timestamp", "result"]
    n0 = len(d)
    d = d.drop_duplicates(subset=key).copy()
    rep += [f"Control rows: {n0}  |  duplicates removed: {n0 - len(d)}  |  unparseable timestamps: {bad_ts}"]

    # --- level renumbering by ascending target ----------------------------------
    lvl = (d.groupby(["test_code", "control_name"])["target_in_force"].median()
             .reset_index().sort_values(["test_code", "target_in_force"]))
    lvl["level"] = "L" + (lvl.groupby("test_code").cumcount() + 1).astype(str)
    d = d.merge(lvl[["test_code", "control_name", "level"]], on=["test_code", "control_name"])

    d["lis_limit_low"] = d["target_in_force"] - 2 * d["sd_defined_in_lis"]
    d["lis_limit_high"] = d["target_in_force"] + 2 * d["sd_defined_in_lis"]
    d["z_vs_target"] = (d["result"] - d["target_in_force"]) / d["sd_defined_in_lis"]
    d["lis_rule_outcome"] = d["Multi-rule QC"]
    d["lis_qc_status"] = d["QC status"]
    d["lis_masked"] = d["QC status"].str.contains("Masked").astype(int)
    d["lis_review"] = d["Review"]
    d["lis_rejected"] = (d["Review"] == "Rejected").astype(int)
    d["bottle_status"] = d["Bottle status"]
    d["reagent_lot_r1"] = d["R1 lot"]
    d = d.sort_values(["analyte", "instrument", "level", "timestamp"])

    full_cols = ["analyte", "test_code", "unit", "timestamp", "instrument", "level", "control_name",
                 "lot", "result", "target_in_force", "sd_defined_in_lis", "lis_limit_low",
                 "lis_limit_high", "z_vs_target", "lis_rule_outcome", "lis_qc_status", "lis_masked",
                 "lis_review", "lis_rejected", "bottle_status", "reagent_lot_r1", "source_file"]
    d[full_cols].to_csv(os.path.join(out, "qc_measurements.csv"), index=False,
                        date_format="%Y-%m-%d %H:%M:%S")

    acc = d[d["lis_rejected"] == 0]
    acc[["analyte", "level", "lot", "instrument", "result"]].to_csv(
        os.path.join(out, "tool_import.csv"), index=False)

    # --- coverage ---------------------------------------------------------------
    rep += ["", "## Coverage", "",
            "| Analyte | Instrument | Level | Control | First | Last | n | Days | Gaps > 1 day |",
            "|---|---|---|---|---|---|---|---|---|"]
    for (a, i, l), g in d.groupby(["analyte", "instrument", "level"]):
        days = g["timestamp"].dt.normalize().drop_duplicates().sort_values()
        gaps = days.diff().dt.days
        gl = ", ".join(f"{p.date()} ({int(x)} d)" for p, x in zip(days[gaps > 1], gaps[gaps > 1])) or "none"
        rep.append(f"| {a} | {i} | {l} | {g['control_name'].iat[0]} | {g['timestamp'].min():%Y-%m-%d} | "
                   f"{g['timestamp'].max():%Y-%m-%d} | {len(g)} | {days.size} | {gl} |")

    # --- lots and LIS targets ---------------------------------------------------
    rep += ["", "## Control lots and LIS target / SD in force", "",
            "| Analyte | Level | Lot | Target | SD (LIS) | CV (LIS) | n | From | To |",
            "|---|---|---|---|---|---|---|---|---|"]
    for (a, l, lot, t, s), g in d.groupby(["analyte", "level", "lot", "target_in_force", "sd_defined_in_lis"]):
        rep.append(f"| {a} | {l} | {lot} | {t:g} | {s:g} | {100*s/t:.2f}% | {len(g)} | "
                   f"{g['timestamp'].min():%Y-%m-%d} | {g['timestamp'].max():%Y-%m-%d} |")

    # --- imprecision ------------------------------------------------------------
    cv = acc.groupby(["analyte", "level", "instrument"]).apply(pooled_cv, include_groups=False).reset_index()
    tg = acc.groupby(["analyte", "level"]).agg(target=("target_in_force", "median"),
                                               sd_lis=("sd_defined_in_lis", "median")).reset_index()
    cv = cv.merge(tg, on=["analyte", "level"])
    cv["bias_vs_target_pct"] = 100 * (cv["mean"] / cv["target"] - 1)
    cv["cv_lis_pct"] = 100 * cv["sd_lis"] / cv["target"]
    cv["observed_to_defined"] = cv["cv"] / cv["cv_lis_pct"]
    cv = cv.round(4)
    cv.to_csv(os.path.join(out, "cv_by_instrument.csv"), index=False)
    worst = cv.loc[cv.groupby(["analyte", "level"])["cv"].idxmax()].reset_index(drop=True)
    pooled_mean = acc.groupby(["analyte", "level"])["result"].mean().rename("pooled_mean").reset_index()
    worst = worst.merge(pooled_mean, on=["analyte", "level"]).round(4)
    worst.to_csv(os.path.join(out, "cv_worst_instrument.csv"), index=False)

    rep += ["", "## Imprecision (Accepted only, pooled within-lot)", "",
            "| Analyte | Level | Instrument | n | Mean | CV % | LIS CV % | Obs/def | Bias vs target % |",
            "|---|---|---|---|---|---|---|---|---|"]
    for _, r in cv.iterrows():
        star = " ★" if ((worst["analyte"] == r["analyte"]) & (worst["level"] == r["level"]) &
                        (worst["instrument"] == r["instrument"])).any() else ""
        rep.append(f"| {r['analyte']} | {r['level']} | {r['instrument']}{star} | {int(r['n'])} | {r['mean']:.4g} | "
                   f"{r['cv']:.2f} | {r['cv_lis_pct']:.2f} | {r['observed_to_defined']:.2f} | {r['bias_vs_target_pct']:+.2f} |")
    rep.append("")
    rep.append("★ = worst instrument, carried forward to the rule design.")

    # --- rejections -------------------------------------------------------------
    rj = d[d["lis_rejected"] == 1]
    rj[["analyte", "instrument", "level", "timestamp", "result", "target_in_force", "z_vs_target",
        "lis_rule_outcome", "lis_qc_status"]].to_csv(os.path.join(out, "rejections.csv"), index=False,
                                                     date_format="%Y-%m-%d %H:%M:%S")
    rep += ["", "## LIS rejections (kept in qc_measurements.csv, excluded from CV)", "",
            "| Analyte | Level | Instrument | Control rows | Rejected | % | |z| < 2 | 2 ≤ |z| < 3 | |z| ≥ 3 |",
            "|---|---|---|---|---|---|---|---|---|"]
    for (a, l, i), g in d.groupby(["analyte", "level", "instrument"]):
        r = g[g["lis_rejected"] == 1]; z = r["z_vs_target"].abs()
        rep.append(f"| {a} | {l} | {i} | {len(g)} | {len(r)} | {100*len(r)/len(g):.1f} | "
                   f"{(z < 2).sum()} | {((z >= 2) & (z < 3)).sum()} | {(z >= 3).sum()} |")

    # --- drift of the mean vs target, by quarter ---------------------------------
    acc = acc.copy(); acc["quarter"] = acc["timestamp"].dt.to_period("Q").astype(str)
    pv = acc.pivot_table(index="quarter", columns=["analyte", "level", "instrument"],
                         values="z_vs_target", aggfunc="mean").round(2)
    rep += ["", "## Mean z-score vs LIS target, by quarter (Accepted only)", "",
            "| Quarter | " + " | ".join(f"{a} {l} {i}" for a, l, i in pv.columns) + " |",
            "|---|" + "---|" * len(pv.columns)]
    for q, row in pv.iterrows():
        rep.append(f"| {q} | " + " | ".join(f"{v:+.2f}" for v in row.values) + " |")

    with open(os.path.join(out, "qc_report.md"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(rep) + "\n")
    print("\n".join(rep))
    print(f"\nWritten to {out}: qc_measurements.csv ({len(d)} rows), tool_import.csv ({len(acc)} rows), "
          "cv_by_instrument.csv, cv_worst_instrument.csv, rejections.csv, qc_report.md")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "raw", sys.argv[2] if len(sys.argv) > 2 else "out")
