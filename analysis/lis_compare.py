import json, math, pandas as pd
from analysis.rule_search import ncdf, pfr, ped, combine, Z, PED_REQ, shifts_for
LV=pd.read_csv('data/prepared/tool_values_by_level.csv')
R=json.load(open('results/rule_search_results.json'))
print(f"{'Analyte':16s} {'Lvl':3s} {'target':>8} {'CV%':>5} {'SD obs':>7} {'SD LIS':>7} {'K now':>5} {'Pfr now':>7} {'Ped now':>7} | {'K new':>5} {'SD new':>7} {'limit ±':>8}")
rows=[]
for o in R:
    a=o['analyte']; c=o['chosen']; lv=LV[LV.analyte==a].sort_values('level')
    pf_now=[];pd_now=[]
    shifts,_=shifts_for([(float(x.cv),float(x.bias)) for x in lv.itertuples()], c['tea'])
    for i,x in enumerate(lv.itertuples()):
        sd_obs=x.target*x.cv/100; k_now=3*x.lis_sd_in_lot/sd_obs
        shift=shifts[i]
        pfn=pfr(k_now); pdn=ped(k_now,shift); pf_now.append(pfn); pd_now.append(pdn)
        k_new=c['ks'][i]; sd_new=sd_obs*k_new/3; lim=sd_obs*k_new
        print(f"{a if i==0 else '':16s} {x.level:3s} {x.target:8.3f} {x.cv:5.2f} {sd_obs:7.3f} {x.lis_sd_in_lot:7.3f} {k_now:5.2f} {pfn*100:7.2f} {pdn*100:7.1f} | {k_new:5.1f} {sd_new:7.3f} {lim:8.3f}")
        rows.append(dict(analyte=a,level=x.level,unit=x.unit,target=round(x.target,4),cv=x.cv,bias=x.bias,sd_observed=round(sd_obs,4),sd_lis=x.lis_sd_in_lot,lis_target=x.lis_target_in_lot,k_current=round(k_now,2),
                         tea_source=c['source'],tea=c['tea'],crit_error_pct=c.get('crit'),sigma=round(c['sigma'][i],2),k_new=k_new,sd_for_lis=round(sd_new,4),action_limit=round(lim,4),pfr_level_new=round(pfr(k_new)*100,2),ped_level_new=round(ped(k_new,shift)*100,1)))
    print(f"{'':16s} combined now: Pfr {combine(pf_now)*100:.2f}%  Ped {combine(pd_now)*100:.1f}%   -> new: Pfr {c['pfr']*100:.2f}%  Ped {c['ped']*100:.1f}%  (req {PED_REQ[a]}%)")
pd.DataFrame(rows).to_csv('results/panel_rules.csv',index=False)
