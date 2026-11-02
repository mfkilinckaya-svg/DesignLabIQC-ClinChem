// Annals of Clinical Biochemistry version: same study, fewer references to the haematology
// manuscript, three figures in the main text (retrospective and monthly-mean figures moved to
// supplementary), Sage declarations.
const en = require("./content.js");
const C = JSON.parse(JSON.stringify(en));

function sub(arr, i, pairs) {
  for (const [a, b] of pairs) {
    if (!arr[i].includes(a)) throw new Error("missing: " + a.slice(0, 60));
    arr[i] = arr[i].replace(a, b);
  }
}

C.shortTitle = "Control rules from imprecision: the allowable-error source decides";

C.abstract = {
  Background: "Internal quality control rules are rarely derived from measured imprecision, and allowable total error (TEa) sources disagree. We derived rules for ten measurands.",
  Methods: "Fourteen months of control results (n=27,963) on two Roche cobas pro systems gave per level the worst analyser's within-lot CV, lot mean and offset. TEa limits from 14 sources, from EFLM biological variation (BV) to national limits, were compared; the strictest source giving sigma ≥3 and a rule meeting the detection requirement within a 1.5% false-rejection allowance was adopted. Rules derived from 2025 were tested on 2026 data, injected errors and 2,465 calibration and reagent-lot events.",
  Results: "Observed CV was below the LIS CV at 17 of 20 levels (median ratio 0.73); published limits differed up to 29-fold. A BV tier was adopted for TSH, glucose and PSA only; for sodium, calcium and 25-OH vitamin D only limits wider than clinical use requires were attainable. Derived rules raised predicted detection from a median 37% to 72–100%. On 2026 data they rejected 3.3% with lot-start targets and 1.4% re-centred (predicted 0.68%); the excess marked real shifts, such as a 4% glucose step confirmed by EQA. Injected errors were detected as predicted for six measurands, 8–17 points less for four with between-day variation; 9 of 11 events leaving a critical-size error were caught on the first run.",
  Conclusions: "Derived rules are attainable and outperform the rules in force; controllability depends more on the TEa source than on the analyser, and false rejections beyond the Gaussian estimate mark uncorrected shifts.",
};

// Introduction: one citation of the haematology study
sub(C.introduction, 2, [[
  "In a haematology study we derived IQC rules from the pooled within-lot imprecision of three analysers, with the target on the laboratory's own pooled mean, and found that whether a parameter looked controllable depended more on the TEa source than on the analyser [16]. This study applies the method to ten clinical chemistry and immunoassay measurands on a Roche cobas pro, with more candidate TEa sources and 14 months of data in which calibration and reagent-lot changes test the Gaussian false-rejection estimate.",
  "This study derives IQC rules for ten clinical chemistry and immunoassay measurands on a Roche cobas pro from the pooled within-lot imprecision of the laboratory's own analysers, with the target on its own lot mean, and asks which of 14 published TEa sources leave a rule attainable at all, how the critical error should be sized when the control levels differ in CV, and whether the Gaussian false-rejection estimate holds over 14 months in which calibration and reagent-lot changes occur. A first application of the approach to a haematology panel found that the TEa source mattered more than the analyser (tool and data deposited [16]; manuscript under review); the present study extends it with more candidate sources and corrects the way the critical error was sized there.",
]]);

// Methods: rule derivation and tool, no reliance on the haematology paper
const rd = C.methods.find((s) => s[0] === "Rule derivation");
sub(rd, 1, [
  ["with evaluating each level at its own critical shift (sigma − 1.65), as in the haematology study [16], which overstates combined detection.",
   "with evaluating each level at its own critical shift (sigma − 1.65), which answers a different question for each level and overstates combined detection."],
  ["The detection requirement was 90% for sodium, creatinine, glucose, calcium and hs-TnT and 70% for the others, following the clinical weighting of the haematology study [16].",
   "The detection requirement was set by clinical judgement at 90% for sodium, creatinine, glucose, calcium and hs-TnT, where a missed systematic error changes treatment decisions within hours, and 70% for the others."],
]);
sub(rd, 2, [[
  "The calculations are those of the DesignLabIQC tool [16], extended to two-level panels, user-entered TEa sources and direct import of cobas infinity exports (DesignLabIQC-ClinChem, https://github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem, MIT licence), a single HTML file that opens in a browser with this panel loaded.",
  "The calculations were implemented in a browser-based tool (DesignLabIQC-ClinChem, https://github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem, MIT licence), a single HTML file that runs without installation, accepts two-level panels, user-entered TEa sources and direct import of cobas infinity exports, and opens with this panel loaded.",
]]);

// Results: figure numbering (3 main figures; retrospective and monthly-mean figures supplementary)
const r3 = C.results.find((s) => s[0].startsWith("Derived rules"));
sub(r3, 1, [["Figure 5 shows detection per level and combined", "Figure 3 shows detection per level and combined"]]);
const r4 = C.results.find((s) => s[0].startsWith("Retrospective"));
sub(r4, 1, [["ALT L1 from 3.8% to 1.2% (Figure 3).", "ALT L1 from 3.8% to 1.2% (Supplementary Figure S1)."], ["Figure 4 shows four levels:", "Supplementary Figure S2 shows four levels:"]]);

// Discussion: one citation of the haematology study
sub(C.discussion, 0, [[
  "The main finding repeats, on another platform and panel, the conclusion of the haematology study [16]: the rules a laboratory can justify from its own imprecision depend less on the analyser than on the allowable-error source it chooses.",
  "The main finding is that the rules a laboratory can justify from its own imprecision depend less on the analyser than on the allowable-error source it chooses; the same was found for a haematology panel on a different platform (tool and data in [16]; manuscript under review).",
]]);
sub(C.discussion, 1, [[
  "lowered the combined detection of the adopted rules by up to 17 percentage points against the per-level convention of the haematology study and moved",
  "lowered the combined detection of the adopted rules by up to 17 percentage points against the per-level convention and moved",
]]);
sub(C.discussion, 2, [[
  "in line with the haematology study [16] and earlier work on biased targets [34].",
  "in line with earlier work on biased targets [34].",
]]);

C.legends = [
  en.legends[0],
  en.legends[1],
  en.legends[4].replace("Figure 5.", "Figure 3.").replace("each level with its own CV and K (thin lines)", "each level with its own CV and K (thin lines: L1 solid, L2 dashed)").replace("dotted red line: the adopted allowable total error; dotted grey line: the detection requirement", "vertical dotted line: the adopted allowable total error; horizontal dotted line: the detection requirement"),
];
C.supplementary = [
  ...en.supplementary.slice(0, 5),
  en.legends[2].replace("Figure 3.", "Supplementary Figure S1."),
  en.legends[3].replace("Figure 4.", "Supplementary Figure S2."),
  ...en.supplementary.slice(5),   // Text S1, Table S6, Table S7, Supplementary Data
];

C.guarantor = "MFK.";
C.contributions = "MFK designed the study, extracted and analysed the data, wrote the software and the manuscript, and is the guarantor.";
C.ethics = "The study used only internal quality control results of the laboratory's own control materials. No patient samples, patient data or personal data were involved, and under the Norwegian Health Research Act no approval by a regional ethics committee (REK) was required; this was confirmed by the data protection officer of Helse Møre og Romsdal HF.";
C.aiStatement = "Analysis scripts, the browser-based tool and the manuscript were drafted with the assistance of a large language model (Claude, Anthropic). The author specified the methods, checked every calculation against the exported data, verified all results and references, and takes full responsibility for the content.";

// Sage Vancouver: first three authors, then et al.
C.references = en.references.map((r) => {
  const i = r.indexOf(". "); if (i < 0) return r;
  const authors = r.slice(0, i); const rest = r.slice(i);
  if (/^[A-Z][a-z]/.test(authors) && !/,/.test(authors)) return r;
  const parts = authors.replace(/,? et al$/, "").split(", ");
  if (parts.length <= 3) return r;
  return parts.slice(0, 3).join(", ") + ", et al" + rest;
});
module.exports = C;
