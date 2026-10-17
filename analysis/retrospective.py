"""Retrospective rejection rates for the panel under three target configurations.
Rule: chosen K per level (results/panel_rules.csv) x observed SD (worst-analyser CV x target), centre varies:
  A  LIS target in force          (what the LIS used)
  B  pooled lot mean, all analysers
  C  analyser-specific lot mean
Baseline: the LIS's own rule, target in force +/- 3 x defined SD.
All control results are used, including those the LIS rejected; results carrying an instrument flag are
counted separately (they are rejected whatever the centre)."""
import pandas as pd, numpy as np
M=pd.read_csv('data/prepared/qc_measurements.csv',low_memory=False)
R=pd.read_csv('results/panel_rules.csv')
rows=[]
for r in R.itertuples():
    d=M[(M.analyte==r.analyte)&(M.level==r.level)].copy()
    d['flag']=d.instrument_flag.fillna('')!=''
    # lot means from results used for imprecision (accepted, unflagged); fall back to all rows if a lot has <20
    good=d[d.used_for_imprecision==1]
    lot_mean=good.groupby('lot').result.mean(); lot_n=good.groupby('lot').result.size()
    inst_mean=good.groupby(['lot','instrument']).result.mean()
    d['c_lis']=d.target_in_force
    d['c_pool']=d.lot.map(lot_mean)
    d['c_inst']=[inst_mean.get((l,i),np.nan) for l,i in zip(d.lot,d.instrument)]
    d['c_pool']=d.c_pool.fillna(d.c_lis); d['c_inst']=d.c_inst.fillna(d.c_pool)
    # SD of the rule: CV of the worst analyser x the centre in use (same CV in every configuration)
    cv=r.cv/100; K=r.k_new
    out=dict(analyte=r.analyte,level=r.level,n=len(d),n_flagged=int(d.flag.sum()),n_lis_rejected=int(d.lis_rejected.sum()),
             K=K,cv=r.cv,lots=d.lot.nunique())
    base=(abs(d.result-d.target_in_force)>3*d.sd_defined_in_lis)
    out['rej_lis_rule_pct']=100*base.mean()
    for name,c in (('A_lis_target','c_lis'),('B_pooled_mean','c_pool'),('C_analyser_mean','c_inst')):
        rej=abs(d.result-d[c])>K*cv*d[c]
        out[f'{name}_pct']=100*rej.mean()
        out[f'{name}_unflagged_pct']=100*rej[~d.flag].mean()
    # offset of the LIS target from the pooled mean, in observed SD
    off=(d.c_lis-d.c_pool)/(cv*d.c_pool)
    out['lis_offset_sd_median']=float(np.median(abs(off)))
    rows.append(out)
T=pd.DataFrame(rows)
T.to_csv('results/retrospective_rejections.csv',index=False)
pd.set_option('display.width',250)
print(T[['analyte','level','n','n_flagged','n_lis_rejected','K','rej_lis_rule_pct','A_lis_target_pct','B_pooled_mean_pct','C_analyser_mean_pct','lis_offset_sd_median']].round(2).to_string(index=False))
# weighted overall
w=T.n
print('\nOverall (all results):  LIS rule %.2f%% | A %.2f%% | B %.2f%% | C %.2f%%'%tuple((T[c]*w).sum()/w.sum() for c in ['rej_lis_rule_pct','A_lis_target_pct','B_pooled_mean_pct','C_analyser_mean_pct']))
print('Overall (unflagged):    A %.2f%% | B %.2f%% | C %.2f%%'%tuple((T[c]*w).sum()/w.sum() for c in ['A_lis_target_unflagged_pct','B_pooled_mean_unflagged_pct','C_analyser_mean_unflagged_pct']))
