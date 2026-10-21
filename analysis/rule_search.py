"""Apply the TEa hierarchy and the tool's rule search to the 10-analyte panel.
Same arithmetic as tool/iqc-rule-designer-clinchem.jsx (search strategy: combined detection).
Critical error convention (CRIT_MODE):
  'common'   one critical systematic error per measurand, in per cent: TEa - max_i(|bias_i| + z*CV_i); converted to SD at each level
             with that level's CV, detection combined over levels (default; a systematic error has one size).
  'perlevel' each level evaluated at its own critical error (sigma_i - z); kept for comparison (results/*_perlevel.*)."""
import os
CRIT_MODE = os.environ.get("CRIT_MODE", "common")
import math, collections, itertools, json
import openpyxl, pandas as pd

XL='data/TEa_sources_clinical_chemistry.xlsx'
LV=pd.read_csv('data/prepared/tool_values_by_level.csv')
PANEL=['Sodium','Creatinine','ALT','Glucose','Calcium','TSH','hs-Troponin T','Ferritin','PSA','25-OH vitamin D']
PED_REQ={'Sodium':90,'Creatinine':90,'ALT':70,'Glucose':90,'Calcium':90,'TSH':70,'hs-Troponin T':90,'Ferritin':70,'PSA':70,'25-OH vitamin D':70}
PFR_BUDGET=0.015; Z=1.65; K_GRID=[v/10 for v in range(15,51)]

def ncdf(z): return 0.5*math.erfc(-z/math.sqrt(2))
def inside(k,s): return ncdf(k-s)-ncdf(-k-s)
def pfr(k,n=1): return 1-inside(k,0)**n
def ped(k,s,n=1): return 0 if s<=0 else 1-inside(k,s)**n
def combine(ps):
    m=1
    for p in ps: m*=1-p
    return 1-m

def shifts_for(levels, tea):
    if CRIT_MODE == "perlevel":
        return [(tea-abs(b))/cv - Z for cv,b in levels], None
    crit = tea - max(abs(b) + Z*cv for cv,b in levels)
    return [max(0.0, (crit-abs(b))/cv) for cv,b in levels], crit

def search(levels, tea, ped_req):
    """levels: list of (cv,bias). Returns best (ks, pfr, ped) by 'ends' strategy within budget, or None."""
    shifts, crit = shifts_for(levels, tea)
    best=None
    for ks in itertools.product(K_GRID, repeat=len(levels)):
        pf=combine([pfr(k) for k in ks])
        if pf>PFR_BUDGET+1e-12: continue
        peds=[ped(k,s) for k,s in zip(ks,shifts)]
        cp=combine(peds)
        score=cp*1000-pf   # combined detection first (tool strategy 'combined')
        if best is None or score>best['score']:
            best=dict(score=score,ks=ks,pfr=pf,ped=cp,peds=peds)
    return best

# TEa per analyte × source
wb=openpyxl.load_workbook(XL,data_only=True)
T=collections.defaultdict(dict)
for r in wb['For the tool'].iter_rows(min_row=5):
    v=[c.value for c in r]
    if v[0] in PANEL and v[3] not in (None,''): T[v[0]][v[2]]=float(v[3])

out=[]
for a in PANEL:
    lv=LV[LV.analyte==a].sort_values('level')
    levels=[(float(x.cv),float(x.bias)) for x in lv.itertuples()]
    rows=[]
    for src,tea in sorted(T[a].items(), key=lambda kv: kv[1]):
        sig=[(tea-abs(b))/cv for cv,b in levels]
        ok_sigma=all(s>=3 for s in sig)
        best=search(levels,tea,PED_REQ[a]) if ok_sigma else None
        if best: best['crit']=shifts_for(levels,tea)[1]
        ok_rule=bool(best) and best['ped']*100>=PED_REQ[a]-1e-9
        rows.append(dict(source=src,tea=tea,sigma=sig,ok_sigma=ok_sigma,best=best,ok=ok_sigma and ok_rule))
    chosen=next((r for r in rows if r['ok']),None)
    out.append(dict(analyte=a,levels=lv,rows=rows,chosen=chosen))

# ---- report
print(f"{'Analyte':16s} {'Chosen source':22s} {'TEa':>5} {'σL1':>5} {'σL2':>5} {'K L1':>5} {'K L2':>5} {'Pfr%':>5} {'Ped%':>5}  Ped req")
for o in out:
    c=o['chosen']
    if c:
        b=c['best']
        print(f"{o['analyte']:16s} {c['source']:22s} {c['tea']:5.1f} {c['sigma'][0]:5.2f} {c['sigma'][1]:5.2f} {b['ks'][0]:5.1f} {b['ks'][1]:5.1f} {b['pfr']*100:5.2f} {b['ped']*100:5.1f}  {PED_REQ[o['analyte']]}")
    else:
        print(f"{o['analyte']:16s} {'— none qualifies':22s}")
print()
for o in out:
    print(f"== {o['analyte']} (Ped req {PED_REQ[o['analyte']]}%)")
    for r in o['rows']:
        b=r['best']
        tag='CHOSEN' if r is o['chosen'] else ('ok' if r['ok'] else ('σ<3' if not r['ok_sigma'] else 'Ped short'))
        bs=f"K {b['ks'][0]:.1f}/{b['ks'][1]:.1f} Pfr {b['pfr']*100:.2f}% Ped {b['ped']*100:.1f}% (L1 {b['peds'][0]*100:.0f}, L2 {b['peds'][1]*100:.0f})" if b else ''
        print(f"  {r['source']:22s} TEa {r['tea']:5.1f}  σ {r['sigma'][0]:5.2f}/{r['sigma'][1]:5.2f}  {tag:9s} {bs}")
json.dump([dict(analyte=o['analyte'],chosen=o['chosen'] and dict(source=o['chosen']['source'],tea=o['chosen']['tea'],sigma=o['chosen']['sigma'],ks=o['chosen']['best']['ks'],pfr=o['chosen']['best']['pfr'],ped=o['chosen']['best']['ped'],crit=o['chosen']['best'].get('crit'),peds=o['chosen']['best']['peds']),
              rows=[dict(source=r['source'],tea=r['tea'],sigma=r['sigma'],ok=r['ok'],ks=r['best']['ks'] if r['best'] else None,pfr=r['best']['pfr'] if r['best'] else None,ped=r['best']['ped'] if r['best'] else None) for r in o['rows']]) for o in out],
          open('results/rule_search_results.json' if CRIT_MODE=="common" else 'results/rule_search_results_perlevel.json','w'),indent=1)
