"""Combined detection of the adopted rules under three conventions for the critical systematic error (Supplementary Table S5):
A per-level: each level evaluated at its own critical error (sigma_i - z); B Westgard N=2: the worst level's critical shift in SD applied to both;
C common per-cent error: TEa - max_i(|bias_i| + z CV_i), converted at each level with its CV (used in the study)."""
import math, pandas as pd
def ncdf(z): return 0.5*math.erfc(-z/math.sqrt(2))
def ped(k,s): return 0 if s<=0 else 1-(ncdf(k-s)-ncdf(-k-s))
Z=1.65; R=pd.read_csv("results/panel_rules.csv"); rows=[]
for a,g in R.groupby("analyte",sort=False):
    g=g.sort_values("level"); tea=g.tea.iloc[0]
    critL=[tea-abs(x.bias)-Z*x.cv for x in g.itertuples()]; sdL=[(tea-abs(x.bias))/x.cv-Z for x in g.itertuples()]
    A=1-math.prod(1-ped(x.k_new,s) for x,s in zip(g.itertuples(),sdL))
    w=min(sdL); B=1-math.prod(1-ped(x.k_new,w) for x in g.itertuples())
    c=min(critL); C=1-math.prod(1-ped(x.k_new,max(0,(c-abs(x.bias))/x.cv)) for x in g.itertuples())
    rows.append(dict(analyte=a,source=g.tea_source.iloc[0],tea=round(tea,1),K=f"{g.k_new.iloc[0]:.1f} / {g.k_new.iloc[1]:.1f}",crit_L1_pct=round(critL[0],2),crit_L2_pct=round(critL[1],2),
                     A_per_level_pct=round(100*A,1),B_same_sd_pct=round(100*B,1),C_common_pct=round(100*C,1)))
T=pd.DataFrame(rows); T.to_csv("results/convention_comparison.csv",index=False); print(T.to_string(index=False))
