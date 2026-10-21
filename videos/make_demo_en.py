"""Scripted screen recording of the tool with burned-in English captions and narration (Supplementary Video S1).
Playwright records a webm; ffmpeg converts to mp4."""
import subprocess, shutil, os, glob
from playwright.sync_api import sync_playwright

TOOL = "file:///home/claude/DesignLabIQC-ClinChem/tool/iqc-rule-designer-clinchem.html"
OUT = "/home/claude/demo"
RAW = ["/home/claude/demo/ALT_2025-2026.csv"]
W, H = 1440, 900

CAPTION_JS = """
(() => {
  let bar = document.getElementById('__cap');
  if (!bar) {
    bar = document.createElement('div'); bar.id = '__cap';
    Object.assign(bar.style, {position:'fixed', left:'0', right:'0', bottom:'0', zIndex: 99999,
      background:'rgba(15,23,42,0.92)', color:'#fff', fontFamily:'Inter, system-ui, sans-serif',
      fontSize:'22px', lineHeight:'1.35', padding:'16px 36px', letterSpacing:'0.1px'});
    document.body.appendChild(bar);
  }
  const hl = document.getElementById('__hl');
  bar.innerHTML = arguments[0];
})
"""

import time, numpy as np, soundfile as sf
import sherpa_onnx
VD = "/home/claude/demo/voices/vits-piper-en_GB-alan-medium"
TTS = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=sherpa_onnx.OfflineTtsModelConfig(
    vits=sherpa_onnx.OfflineTtsVitsModelConfig(model=f"{VD}/en_GB-alan-medium.onnx", tokens=f"{VD}/tokens.txt", data_dir=f"{VD}/espeak-ng-data"), num_threads=2)))
SR = 22050
CLIPS = []  # (start_seconds, samples)
T0 = [None]
def say(text):
    a = TTS.generate(text, sid=0, speed=1.0)
    return np.asarray(a.samples, dtype=np.float32), len(a.samples) / a.sample_rate

def main():
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(f"{OUT}/*.webm"): os.remove(f)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": H}, record_video_dir=OUT, record_video_size={"width": W, "height": H}, device_scale_factor=1)
        pg = ctx.new_page()
        T0[0] = time.time()
        pg.goto(TOOL); pg.wait_for_timeout(1200)

        def cap(text, hold, speech=None):
            # narration decides the hold: audio length + a pause
            if speech:
                samples, dur = say(speech)
                CLIPS.append((time.time() - T0[0] + 0.15, samples))
                hold = max(hold, int(dur * 1000) + 900)
            pg.evaluate("(t) => { let bar=document.getElementById('__cap'); if(!bar){bar=document.createElement('div');bar.id='__cap';Object.assign(bar.style,{position:'fixed',left:'0',right:'0',bottom:'0',zIndex:99999,background:'rgba(15,23,42,0.92)',color:'#fff',fontFamily:'system-ui,sans-serif',fontSize:'22px',lineHeight:'1.35',padding:'16px 36px'});document.body.appendChild(bar);} bar.innerHTML=t; }", text)
            pg.wait_for_timeout(hold)
        def highlight(locator, on=True):
            try:
                locator.evaluate("(el, on) => { el.style.outline = on ? '3px solid #b91c1c' : ''; el.style.outlineOffset = on ? '4px' : ''; }", on)
            except Exception: pass
        def scroll_to(locator, offset=120):
            locator.evaluate("(el, off) => { const y = el.getBoundingClientRect().top + window.scrollY - off; window.scrollTo({top: y, behavior: 'smooth'}); }", offset)
            pg.wait_for_timeout(1200)

        # 1 intro
        cap("<b>DesignLabIQC-ClinChem</b> &nbsp;·&nbsp; Control rules from the laboratory's own imprecision. One HTML file, no installation. Supplementary Video S1.", 6500, "This is DesignLab I Q C for clinical chemistry and immunoassays. The tool derives internal quality control rules from the laboratory's own imprecision. It is one HTML file that opens in a browser, without installation. The panel of the study is preloaded; we look at sodium first, then import a raw export for ALT.")
        # 2 settings bar
        bar = pg.get_by_text("False alarm allowance").first
        highlight(bar.locator("xpath=ancestor::div[2]"))
        cap('Settings bar: combined false-rejection allowance (1.5% per control event), detection requirement (90%), safety margin z = 1.65, LIS rule width (3 SD) and <b>critical error: one size for all levels</b>.', 7000, 'The settings bar holds the frame: a combined false-rejection allowance of one point five per cent per control event, a detection requirement of ninety per cent, a safety margin z of one point six five, the width of the rule in the laboratory information system, three S D, and how the critical error is sized: one size in per cent, common to all levels.')
        highlight(bar.locator("xpath=ancestor::div[2]"), False)
        # 3 sodium card header
        sod = pg.locator("section").filter(has=pg.locator("input[value='Sodium']")).first
        scroll_to(sod, 70)
        cap('Sodium. Each level has its own CV: the pooled within-lot CV of the worst ISE unit over 14 months. Target = control-lot mean; bias = largest unit offset.', 7000, 'Here is sodium. Each control level has its own C V: the pooled within-lot C V of the worst I S E unit over fourteen months. The target is the mean of the control lot, and the bias is the largest offset between units.')
        # 4 sources strip
        strip = sod.get_by_text("Same measurement, different specification").first
        scroll_to(strip, 140)
        highlight(strip.locator("xpath=ancestor::div[1]"))
        cap('Same measurement, 14 allowable-error sources: sigma from 0.07 (EFLM optimal) to 8.1 (Turkey). The source, not the analyser, decides whether sodium looks controllable. Adopted: SEKK Dmax 5%.', 8000, 'The same measurement under fourteen sources of allowable total error. Sigma runs from zero point zero seven with the E F L M optimal tier to eight point one with the Turkish limit. The source, not the analyser, decides whether sodium looks controllable. SEKK D max at five per cent is adopted, as the most stringent source at which a rule exists.')
        highlight(strip.locator("xpath=ancestor::div[1]"), False)
        # 5 level table
        tbl = sod.get_by_text("Critical shift").first
        scroll_to(tbl, 160)
        cap('Level table: K per level, sigma, critical shift, false rejection and detection. Critical error for sodium: 2.97% (TEa 5% − max of bias + 1.65·CV). L1 CV 1.09%, L2 0.73% – the same error is 2.8 SD at L1 and 4.1 SD at L2.', 9000, 'The level table shows K per level, sigma, critical shift, false rejection and detection. The critical error for sodium is two point nine seven per cent: the allowable total error of five per cent, minus the largest bias plus one point six five times C V. The levels differ in C V, one point zero nine per cent at L1 and zero point seven three at L2, so the same error is two point eight S D at L1 but four point one at L2.')
        # 6 power curves in %
        sel = sod.locator("select").filter(has_text="No chart").first
        scroll_to(sel, 420)
        sel.select_option(label="Power curves"); pg.wait_for_timeout(900)
        chart = sod.get_by_text("Detection probability against").first
        scroll_to(chart, 120)
        cap('Power curves: <b>probability of detecting a systematic error of a given size</b>. The x-axis is the error in per cent, the same for both levels.', 7000, 'The power curves answer the question that matters: the probability of detecting a systematic error of a given size. The x axis is the error in per cent, the same for both levels.')
        cap('Thin lines: detection per level with its own CV and K. Thick line: combined, 1 − Π(1 − p) – at least one level rejects. At the critical error 2.97%: L1 28%, L2 89%, combined 92.3%.', 9000, 'The thin lines are detection per level, each with its own C V and K. The thick line is the combined probability, one minus the product of one minus p, that at least one level rejects. At the critical error of two point nine seven per cent, detection is twenty-eight per cent at L1, eighty-nine at L2, and ninety-two point three combined. The level with the lower C V does most of the work.')
        cap("Dashed: critical error and TEa. Westgard's N=2 curves assume the same shift in SD at both levels; giving each level its own critical shift overstates combined detection. Here: one error in per cent, converted per level, then combined.", 9500, "The dashed lines mark the critical error and the allowable total error. Westgard's power functions for N equals two assume the same shift in S D at both levels, and giving each level its own critical shift overstates the combined detection. Here one error in per cent is converted to S D at each level with that level's C V, and then combined.")
        # 7 search for rules
        btn = sod.get_by_role("button", name="Search for rules").first
        scroll_to(btn, 300)
        highlight(btn)
        cap('Rule search: K per level from 1.5 to 5.0 SD. The set that keeps combined false rejection ≤ 1.5% with the best combined detection is chosen – here K 3.1 at L1 and 2.5 at L2: tightest where CV is lowest.', 6500, 'The rule search tries K per level from one point five to five S D and picks the set that keeps the combined false rejection under one point five per cent with the best combined detection. For sodium that is K three point one at L1 and two point five at L2: tightest where the C V is lowest.')
        btn.click(); pg.wait_for_timeout(2500)
        highlight(btn, False)
        cap('The result is shown with combined false rejection and detection against the requirement.', 4000, 'The result is shown with combined false rejection and detection against the requirement, and can be applied with one click.')
        # 8 LIS block
        lis = sod.get_by_text("What to enter in the LIS").first
        scroll_to(lis, 120)
        highlight(lis.locator("xpath=ancestor::div[1]"))
        cap('What to enter in the LIS: current target and SD against recommended. L2: target 153.5 → 154.7, SD 1.535 → 0.936. Current rule: combined detection 62% – recommended: 92.3%, false rejection 1.43%.', 9000, 'This block shows what to enter in the laboratory information system: the current target and S D against the recommended ones. For L2 the target moves from one hundred fifty-three point five to one hundred fifty-four point seven, and the S D from one point five three five to zero point nine three six. The current rule detects the critical error with sixty-two per cent combined probability, the recommended one with ninety-two point three, at a false rejection of one point four three per cent.')
        highlight(lis.locator("xpath=ancestor::div[1]"), False)
        # 9 import ALT
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})"); pg.wait_for_timeout(1200)
        imp = pg.get_by_role("button", name="Import results").first
        highlight(imp)
        cap('Import: raw export from cobas infinity (Test, Control, Control lot, Instrument, Result, Target value, SD, Date, R1 lot). Here: ALT, May 2025 – June 2026, one file.', 6000, 'Raw data are imported directly from cobas infinity, with test, control, control lot, instrument, result, target value, S D, date and reagent lot. Here we import ALT from May twenty twenty-five to June twenty twenty-six, in one file.')
        pg.set_input_files("input[type=file]", [RAW[0]]); pg.wait_for_timeout(4000)
        highlight(imp, False)
        cap('CV, target, unit offset and current LIS target/SD are filled in for ALT. Instrument test codes (S-ALAT) are translated automatically.', 5500, "C V, target, unit offset and the current L I S target and S D are filled in for ALT. The instrument's test codes are translated to the panel names automatically.")
        alt = pg.locator("section").filter(has=pg.locator("input[value='ALT']")).first
        scroll_to(alt, 70)
        print("ALTCARD", alt.inner_text()[:600].replace("\n"," | "))
        cap('ALT after import: CV and target from 14 months, sigma against Labquality 12%, critical error about 7%. Detection per level and combined as before.', 6000, 'After the import, ALT has C V and target from fourteen months, and sigma is computed against Labquality at twelve per cent, with a critical error of about seven per cent. Detection is shown per level and combined, as before.')
        # 10 CUSUM
        cus = alt.locator("p:text-is('CUSUM')").first
        scroll_to(cus, 120)
        cap('CUSUM per unit: standardised results accumulate. Theory: about 2 alarms per 1,000 results – observed 30–50. The alarms are within-lot drift, which the single rule does not see.', 9000, 'The tool also has a CUSUM per unit. Standardised results accumulate, and in theory this gives about two alarms per thousand results. Here we see thirty to fifty. The alarms are drift within the lot, which the single-result rule does not catch.')
        pg.evaluate("window.scrollBy({top: 380, behavior: 'smooth'})"); pg.wait_for_timeout(1200)
        cap("The chart shows C⁺ and −C⁻ against h = 5 SD, with alarms marked. Lot changes and alarms reset the sum. EWMA, multirule, measurement uncertainty and reagent-lot steps are under 'More from the same data'.", 7000, 'The chart shows the positive and negative sums against the limit h of five S D, with alarms marked. Lot changes and alarms reset the sum. Further models, E W M A, multirule, measurement uncertainty and reagent-lot steps, are under More from the same data.')
        # 11 outro
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})"); pg.wait_for_timeout(1000)
        cap("Summary: rules derived from the laboratory's own imprecision; one critical error in per cent, converted per level and combined; the tool reports what to enter in the LIS. Code, data and tool: github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem", 9000, "In summary: the rules are derived from the laboratory's own imprecision, one critical error in per cent is converted to S D per level and the levels are combined, and the tool reports what to enter in the laboratory information system. Code, data and tool are open on GitHub.")
        ctx.close(); b.close()
    webm = glob.glob(f"{OUT}/*.webm")[0]
    mp4 = f"{OUT}/DesignLabIQC-ClinChem_Supplementary_Video_S1.mp4"
    # audio track: narration clips placed at their caption times
    total = max(st + len(x) / SR for st, x in CLIPS) + 1.5
    track = np.zeros(int(total * SR) + SR, dtype=np.float32)
    for st, x in CLIPS:
        i = int(st * SR); track[i:i + len(x)] += x * 0.9
    sf.write(f"{OUT}/narration.wav", track, SR)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-i", f"{OUT}/narration.wav", "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p",
                    "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart", mp4], check=True)
    print(mp4, os.path.getsize(mp4))

main()
