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
  Background: "Internal quality control rules are rarely derived from measured imprecision, and the allowable total error (TEa) judging them comes from disagreeing sources. We derived rules for ten clinical chemistry and immunoassay measurands and examined how far they depend on the TEa source.",
  Methods: en.abstract.Methods.replace("for sodium, creatinine, ALT, glucose, calcium, TSH, high-sensitivity troponin T, ferritin, PSA and 25-OH vitamin D on two Roche cobas pro systems", "for ten measurands on two Roche cobas pro systems").replace(", from EFLM biological variation (BV) to EQA and national limits,", ", from EFLM biological variation (BV) to EQA and national limits,"),
  Results: en.abstract.Results,
  Conclusions: en.abstract.Conclusions,
};

// Introduction: one citation of the haematology study
sub(C.introduction, 2, [[
  "In a haematology study we derived IQC rules from the pooled within-lot imprecision of three analysers, with the target on the laboratory's own pooled mean, and found that whether a parameter looked controllable depended more on the TEa source than on the analyser [12]. This study applies the method to ten clinical chemistry and immunoassay measurands on a Roche cobas pro, with many more candidate TEa sources and 14 months of data in which calibration and reagent-lot changes test whether the Gaussian false-rejection estimate holds.",
  "This study derives IQC rules for ten clinical chemistry and immunoassay measurands on a Roche cobas pro from the pooled within-lot imprecision of the laboratory's own analysers, with the target on its own lot mean, and asks three questions: which of 14 published TEa sources leave a rule attainable at all; how the critical error should be sized when the control levels differ in CV; and whether the Gaussian false-rejection estimate holds over 14 months of data in which calibration and reagent-lot changes occur. A first application of the approach to a haematology panel found that the TEa source mattered more than the analyser [12]; the present study extends it, with many more candidate sources, and corrects the way the critical error was sized there.",
]]);

// Methods: rule derivation and tool, no reliance on the haematology paper
const rd = C.methods.find((s) => s[0] === "Rule derivation");
sub(rd, 1, [
  ["Evaluating each level at its own critical shift (sigma − 1.65), as in the haematology study [12], overstates the combined detection; the conventions are compared in Supplementary Table S5.",
   "Evaluating each level at its own critical shift (sigma − 1.65) answers a different question for each level and overstates the combined detection; the conventions are compared in Supplementary Table S5."],
  ["The detection requirement was 90% for sodium, creatinine, glucose, calcium and hs-TnT and 70% for the others, following the clinical weighting of the haematology study [12].",
   "The detection requirement was set by clinical judgement at 90% for sodium, creatinine, glucose, calcium and hs-TnT, where a missed systematic error changes treatment decisions within hours, and 70% for the others."],
]);
sub(rd, 2, [[
  "The calculations are those of the DesignLabIQC tool [12], extended to two-level panels, user-entered TEa sources and direct import of cobas infinity exports (DesignLabIQC-ClinChem, https://github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem, MIT licence): a single HTML file that runs in a browser and opens with this panel loaded.",
  "The calculations were implemented in a browser-based tool (DesignLabIQC-ClinChem, https://github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem, MIT licence): a single HTML file that runs without installation, accepts two-level panels, user-entered TEa sources and direct import of cobas infinity exports, and opens with this panel loaded.",
]]);

// Results: figure numbering (3 main figures; retrospective and monthly-mean figures supplementary)
const r3 = C.results.find((s) => s[0].startsWith("Derived rules"));
sub(r3, 1, [["Figure 5 shows detection per level and combined", "Figure 3 shows detection per level and combined"]]);
const r4 = C.results.find((s) => s[0].startsWith("Retrospective"));
sub(r4, 1, [["ALT L1 from 3.8% to 1.1% (Figure 3).", "ALT L1 from 3.8% to 1.1% (Supplementary Figure S1)."], ["Figure 4 shows four levels:", "Supplementary Figure S2 shows four levels:"]]);

// Discussion: one citation of the haematology study
sub(C.discussion, 0, [[
  "The main finding repeats, on a different platform and panel, the conclusion of the haematology study [12]: the rules a laboratory can justify from its own imprecision depend less on the analyser than on which allowable-error source it chooses.",
  "The main finding is that the rules a laboratory can justify from its own imprecision depend less on the analyser than on which allowable-error source it chooses; the same was found for a haematology panel on a different platform [12].",
]]);
sub(C.discussion, 1, [[
  "lowered the combined detection of the adopted rules by up to 17 percentage points against the per-level convention of the haematology study and moved",
  "lowered the combined detection of the adopted rules by up to 17 percentage points against the per-level convention and moved",
]]);
sub(C.discussion, 2, [[
  "in line with the haematology study [12] and earlier work on biased targets [27].",
  "in line with earlier work on biased targets [27].",
]]);

C.legends = [
  en.legends[0],
  en.legends[1],
  en.legends[4].replace("Figure 5.", "Figure 3."),
];
C.supplementary = [
  ...en.supplementary.slice(0, 5),
  en.legends[2].replace("Figure 3.", "Supplementary Figure S1."),
  en.legends[3].replace("Figure 4.", "Supplementary Figure S2."),
  en.supplementary[5],
];

C.guarantor = "MFK.";
C.contributions = "MFK designed the study, extracted and analysed the data, wrote the software and the manuscript, and is the guarantor.";
C.ethics = "The study used only internal quality control results of the laboratory's own control materials. No patient samples, patient data or personal data were involved, and under the Norwegian Health Research Act no approval by a regional ethics committee (REK) was required.";
C.aiStatement = "Analysis scripts, the browser-based tool and the manuscript were drafted with the assistance of a large language model (Claude, Anthropic). The author specified the methods, checked every calculation against the exported data, verified all results and references, and takes full responsibility for the content.";

module.exports = C;
