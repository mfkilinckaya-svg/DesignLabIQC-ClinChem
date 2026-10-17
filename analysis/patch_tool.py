"""Write TEa sources, BV inputs, chosen source and K per level into the tool's DEFAULT_ANALYTES."""
import re, json, openpyxl, collections
JSX='tool/iqc-rule-designer-clinchem.jsx'
XL='data/TEa_sources_clinical_chemistry.xlsx'
R={o['analyte']:o for o in json.load(open('results/rule_search_results.json'))}
PANEL=list(R)
# TEa input: non-BV sources + CVI/CVG + Ricos desirable
wb=openpyxl.load_workbook(XL,data_only=True); ws=wb['TEa input']
g=None; cols={}
for j in range(1,ws.max_column+1):
    if ws.cell(4,j).value: g=ws.cell(4,j).value
    cols[(g,ws.cell(5,j).value)]=j
rows={ws.cell(r,1).value:r for r in range(6,ws.max_row+1)}
LISTED=['Labquality','CLIA','Rili-BÄK','Noklus','RCPA','China WS/T 403-2024','SEKK Dmax','Belgium WIV-ISP']
def val(a,key):
    v=ws.cell(rows[a],cols[key]).value
    return None if v in (None,'') else v
TIER={'BV EFLM (optimal)':'BV optimal','BV EFLM (desirable)':'BV desirable','BV EFLM (minimum)':'BV minimum'}
src=open(JSX,encoding='utf-8').read()
for a in PANEL:
    opts=[]
    for s in LISTED:
        v=val(a,(s,'%'))
        if v is not None: opts.append((s,float(v)))
    v=val(a,('Turkey MoH 2026','DKD %'))
    if v is not None: opts.append(('Turkey MoH 2026',float(v)))
    v=val(a,('Ricos (BV)','Desirable %'))
    if v is not None: opts.append(('BV Ricos (desirable)',float(v)))
    oth=val(a,('Other','Source name'))
    if oth: opts.append((oth,float(val(a,('Other','%')))))
    cvi,cvg=val(a,('EFLM biological variation','CVI %')),val(a,('EFLM biological variation','CVG %'))
    bv='{ cvi: %g, cvg: %g }'%(cvi,cvg) if cvi is not None and cvg is not None else '{}'
    c=R[a]['chosen']; label=TIER.get(c['source'],c['source'])
    opts_js='[\n      '+',\n      '.join('{ label: %s, value: %g }'%(json.dumps(s,ensure_ascii=False),v) for s,v in opts)+',\n    ]'
    # locate analyte block
    m=re.search(r'(    name: %s,\n(?:.*\n)*?    note: )'%re.escape(json.dumps(a)), src)
    assert m, a
    block=m.group(1); new=block
    repl='    tea: %g,\n    teaSource: %s,\n    teaOptions: %s,\n    bv: %s,'%(c['tea'],json.dumps(label,ensure_ascii=False),opts_js,bv)
    new=re.sub(r'    tea: "",\n    teaSource: "Custom",\n    teaOptions: \[.*?\],\n    bv: \{\},', lambda m: repl, new, flags=re.S)
    assert new!=block, a
    for i,k in enumerate(c['ks']):
        new,n=re.subn(r'(lvl\("L%d", [^,]+, [^,]+, 1, )3\)'%(i+1), r'\g<1>%g)'%k, new); assert n==1,(a,i)
    src=src.replace(block,new)
open(JSX,'w',encoding='utf-8').write(src); print('patched')
