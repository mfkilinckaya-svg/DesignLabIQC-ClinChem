out_path = "../iqc-rule-designer-clinchem.jsx"

# ---- fourth pass: preload the 10-analyte panel with the measured values (1 May 2025 – 30 June 2026)
import json, csv
src = open(out_path, encoding="utf-8").read()
lv = list(csv.DictReader(open("../../data/prepared/tool_values_by_level.csv", encoding="utf-8")))
PANEL_DEF = [  # name, panel, pedReq, note
 ("Sodium", "Clinical chemistry", 90, "ISE module, four units. CV includes accepted results whose QC status was Error (sensitivity CV without them: L1 0.67%)."),
 ("Creatinine", "Clinical chemistry", 90, "Two c 703 units. One control lot over the period; LIS targets 99.2 and 361."),
 ("ALT", "Clinical chemistry", 70, "Three c 703 units. Recalibration step of about +7% on 20–24 May 2025; targets re-set within the lot."),
 ("Glucose", "Clinical chemistry", 90, "Two c 703 units."),
 ("Calcium", "Clinical chemistry", 90, "Two c 703 units. Defined L2 SD (0.99%) equals the observed CV."),
 ("TSH", "Immunochemistry", 70, "Three e 801 units. Control lot changed 24 Feb 2026."),
 ("hs-Troponin T", "Immunochemistry", 90, "Two e 801 units. L1 near the 99th-percentile limit (CV ≤ 10% required). Old L2 lot drifted upwards through 2025; new lot from 24 Feb 2026."),
 ("Ferritin", "Immunochemistry", 70, "Three e 801 units. Four L2 targets over the period; new lot reads below its target."),
 ("PSA", "Immunochemistry", 70, "Two e 801 units. e801-1.1 drifts down between calibrations (≈10% apart from e801-2.1 before the 21 May 2026 recalibration)."),
 ("25-OH vitamin D", "Immunochemistry", 70, "Three e 801 units. Reagent-lot change in June 2025 raised results by ≈10%."),
]
TRP = {"Sodium": 9, "Creatinine": 20, "ALT": 20, "Glucose": 10, "Calcium": 10, "TSH": 25, "Ferritin": 25, "PSA": 25, "25-OH vitamin D": 25}
js = ["const DEFAULT_ANALYTES = ["]
for name, panel, ped, note in PANEL_DEF:
    rows = sorted([r for r in lv if r["analyte"] == name], key=lambda r: r["level"])
    assert rows, name
    levels = ",\n      ".join(
        f'Object.assign(lvl("{r["level"]}", {float(r["target"]):.6g}, {float(r["cv"]):.3f}, 1, 3), {{ bias: {float(r["bias"]):.3f} }})'
        for r in rows)
    opts = f'[{{ label: "Turkey MoH 2026", value: {TRP[name]} }}]' if name in TRP else "[]"
    js.append(f'''  {{
    id: uid(),
    panel: {json.dumps(panel)},
    name: {json.dumps(name)},
    pedReq: {ped},
    unit: {json.dumps(rows[0]["unit"])},
    tea: "",
    teaSource: "Custom",
    teaOptions: {opts},
    bv: {{}},
    levels: [
      {levels},
    ],
    note: {json.dumps(note)},
  }},''')
js.append("];\n")
a = src.index("const DEFAULT_ANALYTES = [")
b = src.index("/* Names offered when adding an allowable-error source.")
src = src[:a] + "\n".join(js) + "\n" + src[b:]
# header comment of the panel
src = src.replace("""Creatinine is pre-filled from 1 May 2025 – 30 June 2026
   (2 630 accepted results). */""", """CV (worst analyser, pooled within lot),
   target (mean of the control lot in use at the end of the period) and analyser offset
   are pre-filled from 1 May 2025 – 30 June 2026. */""")
src = src.replace('const STORE_KEY = "designlabiqc-clinchem-v1";', 'const STORE_KEY = "designlabiqc-clinchem-v2";')
open(out_path, "w", encoding="utf-8").write(src)
print("pass4 ok")
