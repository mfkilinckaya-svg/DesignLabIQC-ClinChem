"""Per analyte x level, the values the tool's importer derives from tool_import.csv:
worst-analyser pooled within-lot CV, target = grand mean of all results, bias = largest analyser offset (%)."""
import pandas as pd, numpy as np
d = pd.read_csv("out/qc_measurements.csv", low_memory=False)
d = d[d.used_for_imprecision == 1]
rows = []
for (a, lv), g in d.groupby(["analyte", "level"]):
    cvs = {}
    for ins, gi in g.groupby("instrument"):
        ss = dof = 0.0; ws = ns = 0
        for _, gl in gi.groupby("lot"):
            v = gl.result.values
            if len(v) < 2: continue
            ss += (len(v)-1)*v.var(ddof=1); dof += len(v)-1; ws += len(v)*v.mean(); ns += len(v)
        if dof: cvs[ins] = (100*np.sqrt(ss/dof)/(ws/ns), ns)
    if not cvs: continue
    worst = max(cvs, key=lambda k: cvs[k][0])
    # Target and analyser offset come from the control lot in use at the end of the period;
    # pooling means across lots with different assigned values would give a meaningless target.
    last = g.sort_values("timestamp").iloc[-1]
    gl = g[g.lot == last.lot]
    if len(gl) < 20:   # lot changed in the last days (e.g. 30 June): use the previous lot
        prev = g[g.lot != last.lot].sort_values("timestamp")
        gl = g[g.lot == prev.iloc[-1].lot] if len(prev) else gl
    target = gl.result.mean()
    off = max(abs(gi.result.mean()-target)/target*100 for _, gi in gl.groupby("instrument"))
    rows.append(dict(analyte=a, test_code=g.test_code.iat[0], unit=g.unit.iat[0], level=lv, control=g.control_name.iat[-1],
                     n=len(g), n_instruments=g.instrument.nunique(), worst_instrument=worst, cv=round(cvs[worst][0], 3),
                     target=float(f"{target:.6g}"), bias=round(off, 3), target_lot=gl.lot.iat[0], n_target_lot=len(gl),
                     lis_target_in_lot=gl.target_in_force.iat[-1], lis_sd_in_lot=gl.sd_defined_in_lis.iat[-1], first=g.timestamp.min()[:10], last=g.timestamp.max()[:10]))
t = pd.DataFrame(rows)
t = t[t.n >= 20]
t.to_csv("out/tool_values_by_level.csv", index=False)
print(len(t), "levels;", t.analyte.nunique(), "analytes")
print(t[t.analyte.isin(["Sodium","Creatinine","hs-Troponin T","C-peptide"])].to_string(index=False))
