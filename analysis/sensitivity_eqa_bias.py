"""Sensitivity: sigma and critical error with the EQA bias in place of the analyser offset.

The study's bias term is the largest analyser offset from the pooled lot mean, which measures the
agreement between analysers, not trueness. Here the median relative deviation of the laboratory's
EQA results from the assigned value over the study period (data/prepared/eqa_labquality.csv and
eqa_immunochemistry.csv) is used instead, and sigma = (TEa - |bias|)/CV and the critical error
TEa - max_i(|bias| + z CV_i) are recomputed for the adopted source. ALT: the median is used
because two low-concentration EQA samples (6.5 and 8.4 U/L) give large percentage deviations.
Writes results/eqa_bias_sensitivity.csv."""
import pandas as pd

Z = 1.65
E = pd.concat([pd.read_csv("data/prepared/eqa_labquality.csv"), pd.read_csv("data/prepared/eqa_immunochemistry.csv")], ignore_index=True)
E = E.dropna(subset=["bias_pct"])
eqa = E.groupby("analyte").bias_pct.agg(n="size", mean="mean", median="median", min="min", max="max")
P = pd.read_csv("results/panel_rules.csv")
rows = []
for a, g in P.groupby("analyte", sort=False):
    g = g.sort_values("level"); tea = g.tea.iloc[0]; b = eqa.loc[a, "median"]
    sig_eqa = [(tea - abs(b)) / cv for cv in g.cv]
    crit_eqa = tea - max(abs(b) + Z * cv for cv in g.cv)
    rows.append(dict(analyte=a, source=g.tea_source.iloc[0], tea=tea, eqa_n=int(eqa.loc[a, "n"]), eqa_bias_mean_pct=round(eqa.loc[a, "mean"], 2),
                     eqa_bias_median_pct=round(b, 2), offset_study_pct=round(g.bias.max(), 2),
                     sigma_L1_study=round(g.sigma.iloc[0], 2), sigma_L2_study=round(g.sigma.iloc[1], 2),
                     sigma_L1_eqa=round(sig_eqa[0], 2), sigma_L2_eqa=round(sig_eqa[1], 2),
                     crit_study_pct=round(g.crit_error_pct.iloc[0], 2), crit_eqa_pct=round(crit_eqa, 2),
                     sigma3_at_both_levels_with_eqa_bias=bool(min(sig_eqa) >= 3)))
T = pd.DataFrame(rows)
T.to_csv("results/eqa_bias_sensitivity.csv", index=False)
pd.set_option("display.width", 250); print(T.to_string(index=False))
