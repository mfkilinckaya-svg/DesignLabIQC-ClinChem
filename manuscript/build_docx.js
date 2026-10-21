const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, LineNumberRestartFormat, PageBreak, PageNumber, Footer, ShadingType,
} = require("docx");
const LANG = process.env.LANG_TR ? "tr" : "en";
const FORMAT = process.env.FORMAT || "cclm";
const C = require(LANG === "tr" ? (FORMAT === "acb" ? "./content_tr_acb.js" : "./content_tr.js") : FORMAT === "acb" ? "./content_acb.js" : "./content.js");
const NFIG = C.legends.length, NSUP = C.supplementary.filter((t) => t.startsWith("Supplementary")).length;
const csv = (p) => {
  const [h, ...rows] = fs.readFileSync(p, "utf8").trim().split("\n").map((l) => l.split(","));
  return rows.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
};
const RES = "/home/claude/DesignLabIQC-ClinChem/results/";
const DATA = "/home/claude/DesignLabIQC-ClinChem/data/prepared/";
const rules = csv(RES + "panel_rules.csv");
const retro = csv(RES + "retrospective_by_analyte.csv");
const vals = csv(DATA + "tool_values_by_level.csv");
const f2 = csv(RES + "figure2_detection_lis_vs_derived.csv");
const R = JSON.parse(fs.readFileSync(RES + "rule_search_results.json", "utf8"));
const ORDER = R.map((o) => o.analyte);

const FONT = "Times New Roman";
const P = (text, opts = {}) =>
  new Paragraph({
    spacing: { line: 480, after: 0 },
    alignment: opts.align || AlignmentType.LEFT,
    children: Array.isArray(text) ? text : [new TextRun({ text, font: FONT, size: 24, bold: opts.bold, italics: opts.italics })],
    ...(opts.para || {}),
  });
const H1 = (t) => new Paragraph({ spacing: { before: 240, line: 480, after: 0 }, children: [new TextRun({ text: t, font: FONT, size: 24, bold: true })] });
const H2 = (t) => new Paragraph({ spacing: { before: 120, line: 480, after: 0 }, children: [new TextRun({ text: t, font: FONT, size: 24, italics: true })] });
const BR = () => new Paragraph({ children: [new PageBreak()] });
const fmt = (x, d) => (x === "" || x == null || isNaN(+x) ? "–" : (+x).toFixed(d));
const sig = (x) => { const v = +x; return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2); };

const SRC_LABEL = { "BV EFLM (desirable)": "BV desirable", "BV EFLM (optimal)": "BV optimal", "BV EFLM (minimum)": "BV minimum", "CLIA": "CLIA 2025", "China WS/T 403-2024": "China WS/T 403" };

// ---------- tables ----------
function table(head, rows, widths, fontSize = 18) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cell = (t, w, bold = false, align = AlignmentType.LEFT) =>
    new TableCell({
      width: { size: w, type: WidthType.DXA },
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
      borders: { top: { style: BorderStyle.NONE, size: 0 }, bottom: { style: BorderStyle.NONE, size: 0 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } },
      children: [new Paragraph({ alignment: align, spacing: { line: 240, after: 0 }, children: [new TextRun({ text: String(t), font: FONT, size: fontSize, bold })] })],
    });
  const headRow = new TableRow({ tableHeader: true, children: head.map((h, i) => { const c = cell(h, widths[i], true); c.options = c.options || {}; return c; }) });
  const body = rows.map((r) => new TableRow({ children: r.map((t, i) => cell(t, widths[i], false, i === 0 ? AlignmentType.LEFT : AlignmentType.RIGHT)) }));
  const tbl = new Table({
    width: { size: total, type: WidthType.DXA }, columnWidths: widths,
    borders: { top: { style: BorderStyle.SINGLE, size: 6 }, bottom: { style: BorderStyle.SINGLE, size: 6 }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 }, insideHorizontal: { style: BorderStyle.NONE, size: 0 }, insideVertical: { style: BorderStyle.NONE, size: 0 } },
    rows: [headRow, ...body],
  });
  return tbl;
}
// header bottom rule: add a thin border under header via a separate row trick: use row of cells with bottom border
function tableWithRule(head, rows, widths, fontSize = 18) {
  const t = table(head, rows, widths, fontSize);
  // set bottom border on header cells
  const hr = t.root.find((x) => x instanceof TableRow) || t.rows?.[0];
  return t;
}

const byA = (a) => vals.filter((v) => v.analyte === a).sort((x, y) => x.level.localeCompare(y.level));
const t1rows = [];
for (const a of ORDER) for (const v of byA(a)) {
  const lisCv = (+v.lis_sd_in_lot / +v.lis_target_in_lot) * 100;
  t1rows.push([v.level === "L1" ? a : "", v.level, v.unit, sig(v.target), v.n, v.worst_instrument, fmt(v.cv, 2), fmt(lisCv, 2), fmt(+v.cv / lisCv, 2), fmt(v.bias, 2)]);
}
const t2rows = ORDER.map((a) => {
  const o = R.find((x) => x.analyte === a); const c = o.chosen; const rr = rules.filter((r) => r.analyte === a).sort((x, y) => x.level.localeCompare(y.level));
  const f = f2.find((x) => x.analyte === a);
  return [a, SRC_LABEL[c.source] || c.source, fmt(c.tea, 1), fmt(c.crit, 2), `${c.sigma[0].toFixed(1)} / ${c.sigma[1].toFixed(1)}`, `${c.ks[0].toFixed(1)} / ${c.ks[1].toFixed(1)}`,
    fmt(c.pfr * 100, 2), fmt(c.ped * 100, 1), f.req, `${sig(rr[0].sd_for_lis)} / ${sig(rr[1].sd_for_lis)}`, `${sig(rr[0].sd_lis)} / ${sig(rr[1].sd_lis)}`];
});
const t3rows = ORDER.map((a) => { const r = retro.find((x) => x.analyte === a); return [a, (+r.n).toFixed(0), fmt(r.design_pfr_pct, 2), fmt(r.rej_lis_rule_pct, 2), fmt(r.A_lis_target_pct, 2), fmt(r.B_pooled_mean_pct, 2), fmt(r.C_analyser_mean_pct, 2), fmt(r.D_analyser_month_mean_pct, 2)]; });
const W = (k) => retro.reduce((s, r) => s + +r[k] * +r.n, 0) / retro.reduce((s, r) => s + +r.n, 0);
t3rows.push(["All", retro.reduce((s, r) => s + +r.n, 0).toFixed(0), fmt(W("design_pfr_pct"), 2), fmt(W("rej_lis_rule_pct"), 2), fmt(W("A_lis_target_pct"), 2), fmt(W("B_pooled_mean_pct"), 2), fmt(W("C_analyser_mean_pct"), 2), fmt(W("D_analyser_month_mean_pct"), 2)]);

// ---------- word count ----------
const words = (arr) => arr.join(" ").split(/\s+/).filter(Boolean).length;
const mainText = [...C.introduction, ...C.methods.flatMap((s) => s.slice(1)), ...C.results.flatMap((s) => s.slice(1)), ...C.discussion];
const nMain = words(mainText);
const nAbs = words(Object.values(C.abstract));
console.log("abstract words", nAbs, "main text words", nMain, "references", C.references.length);

// ---------- document ----------
const titlePage = [
  P(C.title, { bold: true }),
  P(""),
  P(LANG === "tr" ? `Kısa başlık: ${C.shortTitle}` : `Short title: ${C.shortTitle}`),
  P(""),
  P(`${C.author}`), P(C.affiliation), P(`ORCID: ${C.orcid}`),
  P(""),
  P((LANG === "tr" ? "Sorumlu yazar: " : "Corresponding author: ") + C.corresponding),
  P(""),
  P(LANG === "tr" ? `Türkçe okuma sürümü; İngilizce aslının birebir çevirisi. Tablo: 3. Figür: ${NFIG}. Kaynak: ${C.references.length}. Ek öğe: ${NSUP}.` : `Word count: abstract ${nAbs}; main text ${nMain} (excluding abstract, references, tables and figure legends). Tables: 3. Figures: ${NFIG}. References: ${C.references.length}. Supplementary items: ${NSUP}.`),
  P(""),
  P((LANG === "tr" ? "Anahtar kelimeler: " : "Keywords: ") + C.keywords.join("; ")),
  BR(),
  H1(LANG === "tr" ? "Özet" : "Abstract"),
  ...Object.entries(C.abstract).map(([k, v]) => P([new TextRun({ text: k + ": ", font: FONT, size: 24, bold: true }), new TextRun({ text: v, font: FONT, size: 24 })])),
  P(""),
  P((LANG === "tr" ? "Anahtar kelimeler: " : "Keywords: ") + C.keywords.join("; ")),
  BR(),
];
const PLACED = new Set();
const body = [
  H1(LANG === "tr" ? "Giriş" : "Introduction"), ...C.introduction.map((t) => P(t)),
  H1(LANG === "tr" ? "Gereç ve yöntem" : "Methods"), ...C.methods.flatMap(([h, ...ps]) => [H2(h), ...ps.map((t) => P(t))]),
  H1(LANG === "tr" ? "Bulgular" : "Results"), ...C.results.flatMap(([h, ...ps]) => {
    const out = [H2(h), ...ps.map((t) => P(t))];
    if (FORMAT === "acb") {
      const TBL = { t1: [C.tables.t1, t1rows, [1500, 600, 760, 980, 640, 980, 760, 820, 640, 700]], t2: [C.tables.t2, t2rows, [1400, 1150, 600, 650, 950, 800, 600, 600, 560, 1200, 1200]], t3: [C.tables.t3, t3rows, [1500, 700, 950, 950, 1000, 1100, 1150, 1250]] };
      const txt = ps.join(" ");
      for (const [k, n] of [["t1", 1], ["t2", 2], ["t3", 3]]) if (new RegExp((LANG === "tr" ? "Tablo " : "Table ") + n + "\\b").test(txt) && !PLACED.has(k)) {
        PLACED.add(k); const [T, rows, w] = TBL[k];
        out.push(P(""), P(T.title, { para: { spacing: { line: 240 } } }), tableWithRule(T.head, rows, w), P(T.note, { para: { spacing: { line: 240, before: 120 } } }), P(""));
      }
      for (const n of [1, 2, 3]) if (new RegExp(LANG === "tr" ? "(?<!Ek )Figür " + n + "\\b" : "(?<!Supplementary )Figure " + n + "\\b").test(txt) && !PLACED.has("f" + n)) { PLACED.add("f" + n); out.push(P(LANG === "tr" ? `[Figür ${n} buraya.]` : `[insert Figure ${n}.]`, { italics: true })); }
    }
    return out;
  }),
  H1(LANG === "tr" ? "Tartışma" : "Discussion"), ...C.discussion.map((t) => P(t)),
  ...(FORMAT === "acb" ? (LANG === "tr" ? [
  H1("Teşekkür"), P(C.acknowledgements),
  H1("Çıkar çatışması beyanı"), P("Yazar çıkar çatışması bulunmadığını beyan eder."),
  H1("Finansman"), P("Bu araştırma kamu, ticari ya da kâr amacı gütmeyen hiçbir kuruluştan özel bir destek almamıştır."),
  H1("Etik onay"), P(C.ethics),
  H1("Sorumlu yazar (guarantor)"), P(C.guarantor),
  H1("Katkı beyanı"), P(C.contributions),
  H1("Yapay zekâ kullanımı"), P(C.aiStatement),
  H1("Veri erişilebilirliği"), P(C.dataAvailability),
  ] : [
  H1("Acknowledgements"), P(C.acknowledgements),
  H1("Declaration of conflicting interests"), P("The author declares no conflicts of interest."),
  H1("Funding"), P("This research received no specific grant from any funding agency in the public, commercial or not-for-profit sectors."),
  H1("Ethical approval"), P(C.ethics),
  H1("Guarantor"), P(C.guarantor),
  H1("Contributorship"), P(C.contributions),
  H1("Use of artificial intelligence"), P(C.aiStatement),
  H1("Data availability"), P(C.dataAvailability),
  ]) : [
  H1(LANG === "tr" ? "Teşekkür" : "Acknowledgements"), P(C.acknowledgements),
  H1(LANG === "tr" ? "Araştırma desteği" : "Research funding"), P(C.funding),
  H1(LANG === "tr" ? "Yazar katkıları" : "Author contributions"), P(C.contributions),
  H1(LANG === "tr" ? "Çıkar çatışması" : "Competing interests"), P(C.coi),
  H1(LANG === "tr" ? "Etik onay" : "Ethical approval"), P(C.ethics),
  H1(LANG === "tr" ? "Veri erişilebilirliği" : "Data availability"), P(C.dataAvailability),
  ]),
  BR(),
  H1(LANG === "tr" ? "Kaynaklar" : "References"), ...C.references.map((r, i) => P(`${i + 1}. ${r}`)),
  ...(FORMAT === "acb" ? [BR()] : [
  BR(),
  H1(LANG === "tr" ? "Tablolar" : "Tables"),
  P(C.tables.t1.title), tableWithRule(C.tables.t1.head, t1rows, [1500, 600, 760, 980, 640, 980, 760, 820, 640, 700]), P(C.tables.t1.note, { para: { spacing: { line: 240, before: 120 } } }),
  BR(),
  P(C.tables.t2.title), tableWithRule(C.tables.t2.head, t2rows, [1400, 1150, 600, 650, 950, 800, 600, 600, 560, 1200, 1200]), P(C.tables.t2.note, { para: { spacing: { line: 240, before: 120 } } }),
  BR(),
  P(C.tables.t3.title), tableWithRule(C.tables.t3.head, t3rows, [1500, 700, 950, 950, 1000, 1100, 1150, 1250]), P(C.tables.t3.note, { para: { spacing: { line: 240, before: 120 } } }),
  BR(),]),
  H1(LANG === "tr" ? "Figür açıklamaları" : "Figure legends"), ...C.legends.map((t) => P(t)),
  BR(),
  H1(LANG === "tr" ? "Ek materyal" : "Supplementary material"), ...C.supplementary.map((t) => P(t)),
];
const doc = new Document({
  creator: C.author, title: C.title,
  styles: { default: { document: { run: { font: FONT, size: 24 } } } },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } }, lineNumbers: { countBy: 1, restart: LineNumberRestartFormat.CONTINUOUS } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })] })] }) },
    children: [...titlePage, ...body],
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(LANG === "tr" ? (FORMAT === "acb" ? "Kilinckaya_ClinChem_IQC_ACB_TR.docx" : "Kilinckaya_ClinChem_IQC_TR.docx") : FORMAT === "acb" ? "Kilinckaya_ClinChem_IQC_ACB.docx" : "Kilinckaya_ClinChem_IQC_CCLM.docx", b); console.log("written"); });
