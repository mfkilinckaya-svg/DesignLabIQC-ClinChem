"""Manuscript figures (run from the repository root). Okabe–Ito palette, vector PDF/EPS + 1200 dpi TIFF."""
import json
import numpy as np, pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.lines import Line2D

OUT = "figures/"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 8, "axes.linewidth": 0.6,
                     "xtick.major.width": 0.6, "ytick.major.width": 0.6, "pdf.fonttype": 42, "ps.fonttype": 42,
                     "legend.fontsize": 7, "axes.labelsize": 8, "axes.titlesize": 8.5})
MM = 1 / 25.4
OI = {"blue": "#0072B2", "orange": "#E69F00", "green": "#009E73", "sky": "#56B4E9", "verm": "#D55E00",
      "purple": "#CC79A7", "yellow": "#F0E442", "black": "#000000", "grey": "#888888"}

def save(fig, name):
    fig.savefig(OUT + name + ".pdf"); fig.savefig(OUT + name + ".eps")
    fig.savefig(OUT + name + ".tif", dpi=1200, pil_kwargs={"compression": "tiff_lzw"})
    fig.savefig(OUT + name + "_preview.png", dpi=150); plt.close(fig)

R = json.load(open("results/rule_search_results.json"))
rules = pd.read_csv("results/panel_rules.csv")
retro = pd.read_csv("results/retrospective_rejections.csv")
order = [o["analyte"] for o in R]
NAME = {"25-OH vitamin D": "25-OH vitamin D", "hs-Troponin T": "hs-Troponin T"}

# ---------------- Figure 1: sigma by allowable-error source ----------------
SRC = [("BV EFLM (optimal)", "o", OI["blue"], "none"), ("BV EFLM (desirable)", "o", OI["blue"], "half"),
       ("BV EFLM (minimum)", "o", OI["blue"], "full"), ("BV Ricos (desirable)", "s", OI["orange"], "full"),
       ("Labquality", "^", OI["green"], "full"), ("Noklus", "v", OI["green"], "none"),
       ("CLIA", "D", OI["purple"], "full"), ("RfB", "p", OI["purple"], "none"),
       ("Rili-BÄK", "v", OI["verm"], "full"), ("RCPA", "<", OI["sky"], "full"),
       ("China WS/T 403-2024", ">", OI["yellow"], "full"), ("SEKK Dmax", "X", OI["black"], "full"),
       ("Belgium WIV-ISP", "P", OI["grey"], "full"), ("Turkey MoH 2026", "*", OI["orange"], "none")]
LBL = {"CLIA": "CLIA 2025", "China WS/T 403-2024": "China WS/T 403", "Belgium WIV-ISP": "Belgium WIV-ISP",
       "Turkey MoH 2026": "Turkey MoH 2026", "SEKK Dmax": "SEKK Dmax", "RfB": "RfB"}
fig, ax = plt.subplots(figsize=(190 * MM, 118 * MM))
ys = np.arange(len(order))[::-1]
for o, y in zip(R, ys):
    sig = {r["source"]: min(r["sigma"]) for r in o["rows"]}
    vals = list(sig.values())
    ax.plot([min(vals), max(vals)], [y, y], color="#BBBBBB", lw=0.8, zorder=1)
    for lab, mk, col, fill in SRC:
        if lab in sig:
            fc = col if fill == "full" else ("white" if fill == "none" else col)
            ax.scatter(sig[lab], y, marker=mk, s=24, facecolor=fc, edgecolor="black" if col == OI["yellow"] else col,
                       linewidths=0.7, alpha=0.5 if fill == "half" else 1, zorder=3)
    ax.scatter(min(o["chosen"]["sigma"]), y, marker="|", s=110, color="black", linewidths=1.6, zorder=4)
for x, lab in [(3, "3"), (4, "4"), (6, "6")]:
    ax.axvline(x, color="#999999", lw=0.6, ls=":", zorder=0)
    ax.text(x, len(order) - 0.35, lab, ha="center", va="bottom", fontsize=7, color="#666666")
ax.set_xscale("log"); ax.set_xlim(0.06, 20)
ax.set_xticks([0.1, 0.2, 0.5, 1, 2, 3, 4, 6, 10]); ax.set_xticklabels(["0.1", "0.2", "0.5", "1", "2", "3", "4", "6", "10"])
ax.set_yticks(ys); ax.set_yticklabels([NAME.get(n, n) for n in order]); ax.set_ylim(-0.7, len(order) - 0.3)
ax.set_xlabel("Sigma metric of the weaker control level (logarithmic scale)")
ax.grid(axis="y", color="#EEEEEE", lw=0.5)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
handles = []
for lab, mk, col, fill in SRC:
    fc = col if fill == "full" else ("white" if fill == "none" else col)
    handles.append(Line2D([], [], marker=mk, ls="", markerfacecolor=fc, markeredgecolor="black" if col == OI["yellow"] else col,
                          alpha=0.5 if fill == "half" else 1, markersize=5, label=LBL.get(lab, lab)))
handles.append(Line2D([], [], marker="|", ls="", color="black", markersize=9, markeredgewidth=1.6, label="Adopted"))
ax.legend(handles=handles, loc="upper center", bbox_to_anchor=(0.5, -0.13), ncol=5, frameon=False, handletextpad=0.3, columnspacing=1.0)
fig.tight_layout(); save(fig, "Figure_1")

# ---------------- Figure 2: detection and false rejection, LIS rule vs derived rule ----------------
import math
def ncdf(z): return 0.5 * math.erfc(-z / math.sqrt(2))
def inside(k, s): return ncdf(k - s) - ncdf(-k - s)
def pfr(k): return 1 - inside(k, 0)
def ped(k, s): return 0 if s <= 0 else 1 - inside(k, s)
def comb(ps):
    m = 1
    for p in ps: m *= 1 - p
    return 1 - m
rows = []
for a in order:
    r = rules[rules.analyte == a].sort_values("level")
    crit = r.tea.iloc[0] - max(abs(x.bias) + 1.65 * x.cv for x in r.itertuples())
    shifts = [max(0, (crit - abs(x.bias)) / x.cv) for x in r.itertuples()]
    k_now = [3 * x.sd_lis / x.sd_observed for x in r.itertuples()]
    rows.append(dict(analyte=a, ped_now=comb([ped(k, s) for k, s in zip(k_now, shifts)]) * 100, pfr_now=comb([pfr(k) for k in k_now]) * 100,
                     ped_new=comb([ped(k, s) for k, s in zip(r.k_new, shifts)]) * 100, pfr_new=comb([pfr(k) for k in r.k_new]) * 100,
                     req={"Sodium": 90, "Creatinine": 90, "Glucose": 90, "Calcium": 90, "hs-Troponin T": 90}.get(a, 70)))
F2 = pd.DataFrame(rows)
fig, axs = plt.subplots(1, 2, figsize=(190 * MM, 95 * MM), gridspec_kw={"width_ratios": [2.2, 1]})
ax = axs[0]
for i, x in enumerate(F2.itertuples()):
    y = len(F2) - 1 - i
    ax.plot([x.ped_now, x.ped_new], [y, y], color="#BBBBBB", lw=1.2, zorder=1)
    ax.scatter(x.ped_now, y, marker="o", s=26, facecolor="white", edgecolor=OI["verm"], linewidths=1.1, zorder=3)
    ax.scatter(x.ped_new, y, marker="o", s=26, facecolor=OI["blue"], edgecolor=OI["blue"], zorder=3)
    ax.scatter(x.req, y, marker="|", s=80, color="black", linewidths=1.2, zorder=2)
ax.set_yticks(range(len(F2))[::-1]); ax.set_yticklabels(F2.analyte); ax.set_xlim(0, 102)
ax.set_xlabel("Probability of detecting the critical shift (%)")
ax.grid(axis="y", color="#EEEEEE", lw=0.5)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
ax.legend(handles=[Line2D([], [], marker="o", ls="", markerfacecolor="white", markeredgecolor=OI["verm"], markersize=5, label="LIS rule in force (target ± 3 defined SD)"),
                   Line2D([], [], marker="o", ls="", color=OI["blue"], markersize=5, label="Derived rule (K per level, pooled within-lot CV)"),
                   Line2D([], [], marker="|", ls="", color="black", markersize=8, markeredgewidth=1.2, label="Detection requirement")],
          loc="upper center", bbox_to_anchor=(0.5, -0.16), frameon=False, ncol=1)
ax.set_title("A  Error detection at the adopted allowable error", loc="left")
ax = axs[1]
for i, x in enumerate(F2.itertuples()):
    y = len(F2) - 1 - i
    ax.plot([x.pfr_now, x.pfr_new], [y, y], color="#BBBBBB", lw=1.2, zorder=1)
    ax.scatter(x.pfr_now, y, marker="o", s=26, facecolor="white", edgecolor=OI["verm"], linewidths=1.1, zorder=3)
    ax.scatter(x.pfr_new, y, marker="o", s=26, facecolor=OI["blue"], zorder=3)
ax.axvline(1.5, color="black", lw=0.7, ls="--", zorder=0); ax.text(1.5, len(F2) - 0.4, "allowance", ha="center", va="bottom", fontsize=6.5)
ax.set_yticks(range(len(F2))[::-1]); ax.set_yticklabels([]); ax.set_xlim(-0.05, 1.8)
ax.set_xlabel("False rejection per control event (%)")
ax.grid(axis="y", color="#EEEEEE", lw=0.5)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
ax.set_title("B  False rejection", loc="left")
fig.tight_layout(); save(fig, "Figure_2")
F2.round(2).to_csv("results/figure2_detection_lis_vs_derived.csv", index=False)

# ---------------- Figure 3: retrospective rejection by target configuration ----------------
agg = retro.groupby("analyte").apply(lambda g: pd.Series({c: (g[c] * g.n).sum() / g.n.sum() for c in
    ["design_pfr_pct", "rej_lis_rule_pct", "A_lis_target_pct", "B_pooled_mean_pct", "C_analyser_mean_pct", "D_analyser_month_mean_pct"]}
    | {"n": g.n.sum()})).reindex(order)
agg.to_csv("results/retrospective_by_analyte.csv")
CFG = [("A_lis_target_pct", "A  LIS target in force", "o", OI["verm"], "full"),
       ("B_pooled_mean_pct", "B  Pooled lot mean", "s", OI["blue"], "full"),
       ("C_analyser_mean_pct", "C  Analyser lot mean", "^", OI["green"], "full"),
       ("D_analyser_month_mean_pct", "D  Analyser monthly mean", "D", OI["purple"], "none")]
fig, ax = plt.subplots(figsize=(150 * MM, 100 * MM))
for i, a in enumerate(order):
    y = len(order) - 1 - i; g = agg.loc[a]
    ax.plot([g.A_lis_target_pct, min(g.B_pooled_mean_pct, g.C_analyser_mean_pct, g.D_analyser_month_mean_pct)], [y, y], color="#BBBBBB", lw=1, zorder=1)
    ax.scatter(g.design_pfr_pct, y, marker="|", s=90, color="black", linewidths=1.4, zorder=4)
    for c, lab, mk, col, fill in CFG:
        ax.scatter(g[c], y, marker=mk, s=24, facecolor=col if fill == "full" else "white", edgecolor=col, linewidths=0.9, zorder=3)
ax.set_yticks(range(len(order))[::-1]); ax.set_yticklabels(order)
ax.set_xlabel("Control results rejected by the derived rule (%)"); ax.set_xlim(0, 7.5)
ax.grid(axis="y", color="#EEEEEE", lw=0.5)
for s in ["top", "right"]: ax.spines[s].set_visible(False)
h = [Line2D([], [], marker="|", ls="", color="black", markersize=8, markeredgewidth=1.4, label="Design (Gaussian)")]
h += [Line2D([], [], marker=mk, ls="", markerfacecolor=col if fill == "full" else "white", markeredgecolor=col, markersize=5, label=lab) for c, lab, mk, col, fill in CFG]
ax.legend(handles=h, loc="lower right", frameon=False)
fig.tight_layout(); save(fig, "Figure_3")

# ---------------- Figure 4: within-lot movement of analyser means ----------------
M = pd.read_csv("data/prepared/qc_measurements.csv", low_memory=False)
M["month"] = M.timestamp.str[:7]
EX = [("ALT", "L1"), ("25-OH vitamin D", "L1"), ("hs-Troponin T", "L1"), ("Ferritin", "L1")]
INST_MK = {}
fig, axs = plt.subplots(2, 2, figsize=(190 * MM, 120 * MM), sharex=False)
for ax, (a, lv) in zip(axs.flat, EX):
    d = M[(M.analyte == a) & (M.level == lv) & (M.used_for_imprecision == 1)].copy()
    cv = float(rules[(rules.analyte == a) & (rules.level == lv)].cv.iloc[0]) / 100
    lotmean = d.groupby("lot").result.transform("mean")
    d["z"] = (d.result - lotmean) / (cv * lotmean)
    mm = d.groupby(["instrument", "month"]).z.mean().reset_index()
    months = sorted(M.month.unique()); xi = {m: i for i, m in enumerate(months)}
    cols = [OI["blue"], OI["orange"], OI["green"], OI["purple"]]
    for (inst, g), col in zip(mm.groupby("instrument"), cols):
        ax.plot([xi[m] for m in g.month], g.z, marker="o", ms=2.5, lw=0.9, color=col, label=inst)
    # LIS target as offset from lot mean
    d["lm"] = lotmean
    t = d.groupby("month").apply(lambda g: ((g.target_in_force - g.lm) / (cv * g.lm)).mean())
    ax.plot([xi[m] for m in t.index], t.values, color="black", lw=0.8, ls="--", label="LIS target")
    ax.axhline(0, color="#999999", lw=0.5)
    ax.set_title(f"{a} {lv}", loc="left"); ax.set_ylabel("Offset from lot mean (SD units)")
    ax.set_xticks(range(0, len(months), 2)); ax.set_xticklabels([months[i] for i in range(0, len(months), 2)], rotation=45, ha="right", fontsize=6.5)
    for s in ["top", "right"]: ax.spines[s].set_visible(False)
    ax.legend(frameon=False, fontsize=6, ncol=2, loc="best")
fig.tight_layout(); save(fig, "Figure_4")
print(agg.round(2).to_string())

# ---------------- Figure 5: detection against the size of a systematic error, per cent ----------------
fig, axs = plt.subplots(2, 5, figsize=(190 * MM, 85 * MM), sharey=True)
for ax, a in zip(axs.flat, order):
    r = rules[rules.analyte == a].sort_values("level"); tea = r.tea.iloc[0]
    crit = tea - max(abs(x.bias) + 1.65 * x.cv for x in r.itertuples())
    xs = np.linspace(0, tea * 1.15, 120)
    comb = np.ones_like(xs)
    for x, col, ls in zip(r.itertuples(), [OI["green"], OI["sky"]], ["-", "-"]):
        p = np.array([ped(x.k_new, max(0, (e - abs(x.bias)) / x.cv)) for e in xs])
        ax.plot(xs, p, color=col, lw=1, ls=ls, label=x.level)
        comb *= 1 - p
    ax.plot(xs, 1 - comb, color="black", lw=1.6, label="Combined")
    ax.axvline(crit, color="#555555", lw=0.7, ls="--"); ax.axvline(tea, color=OI["verm"], lw=0.7, ls=":")
    req = {"Sodium": 0.9, "Creatinine": 0.9, "Glucose": 0.9, "Calcium": 0.9, "hs-Troponin T": 0.9}.get(a, 0.7)
    ax.axhline(req, color="#999999", lw=0.5, ls=":")
    ax.set_title(a, fontsize=7.5, loc="left"); ax.set_xlim(0, tea * 1.15); ax.set_ylim(0, 1.02)
    ax.tick_params(labelsize=6.5)
    for sp in ["top", "right"]: ax.spines[sp].set_visible(False)
axs[1, 0].set_xlabel("Systematic error (%)"); axs[0, 0].set_ylabel("Probability of rejection"); axs[1, 0].set_ylabel("Probability of rejection")
for ax in axs[1]: ax.set_xlabel("Systematic error (%)")
h = [Line2D([], [], color=OI["green"], lw=1, label="L1"), Line2D([], [], color=OI["sky"], lw=1, label="L2"), Line2D([], [], color="black", lw=1.6, label="Combined (either level)"),
     Line2D([], [], color="#555555", lw=0.7, ls="--", label="Critical error"), Line2D([], [], color=OI["verm"], lw=0.7, ls=":", label="TEa"), Line2D([], [], color="#999999", lw=0.5, ls=":", label="Requirement")]
fig.legend(handles=h, loc="lower center", ncol=6, frameon=False, fontsize=7, bbox_to_anchor=(0.5, -0.01))
fig.tight_layout(rect=(0, 0.05, 1, 1)); save(fig, "Figure_5")
