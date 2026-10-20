"""Scripted screen recording of the tool with burned-in Norwegian captions (no audio).
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

def main():
    os.makedirs(OUT, exist_ok=True)
    for f in glob.glob(f"{OUT}/*.webm"): os.remove(f)
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": W, "height": H}, record_video_dir=OUT, record_video_size={"width": W, "height": H}, device_scale_factor=1)
        pg = ctx.new_page()
        pg.goto(TOOL); pg.wait_for_timeout(1200)

        def cap(text, hold):
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
        cap("<b>DesignLabIQC-ClinChem</b> &nbsp;·&nbsp; Kontrollregler fra laboratoriets egen impresisjon. Én HTML-fil, ingen installasjon. Demo: natrium, deretter import av ALT-rådata.", 6500)
        # 2 settings bar
        bar = pg.get_by_text("False alarm allowance").first
        highlight(bar.locator("xpath=ancestor::div[2]"))
        cap("Øverst: tillatt samlet falsk alarm (1,5 % per kontrollhendelse), deteksjonsmål (90 %), sikkerhetsmargin z = 1,65 og LIS-regelbredde (3 SD).", 6000)
        highlight(bar.locator("xpath=ancestor::div[2]"), False)
        # 3 sodium card header
        sod = pg.locator("section").filter(has=pg.locator("input[value='Sodium']")).first
        scroll_to(sod, 70)
        cap("Natrium. Hvert nivå har sin egen CV: poolet innen-lot CV for den dårligste ISE-enheten over 14 måneder. Målet er lotgjennomsnittet, bias er største enhetsavvik.", 7000)
        # 4 sources strip
        strip = sod.get_by_text("Same measurement, different specification").first
        scroll_to(strip, 140)
        highlight(strip.locator("xpath=ancestor::div[1]"))
        cap("Samme måling, ti feilgrensekilder: sigma fra 0,07 (EFLM optimal) til 8,1 (Tyrkia). Kilden, ikke instrumentet, avgjør om natrium ser kontrollerbart ut. Valgt: SEKK Dmax 5 %.", 8000)
        highlight(strip.locator("xpath=ancestor::div[1]"), False)
        # 5 level table
        tbl = sod.get_by_text("Critical shift").first
        scroll_to(tbl, 160)
        cap("Nivåtabellen: K per nivå, sigma, kritisk skift, falsk alarm og deteksjon. L1 har CV 1,09 %, L2 0,73 % – en feil på 3 % er 2,8 SD på L1 og 4,1 SD på L2.", 8000)
        # 6 power curves in %
        sel = sod.locator("select").filter(has_text="No chart").first
        scroll_to(sel, 420)
        sel.select_option(label="Power curves"); pg.wait_for_timeout(900)
        chart = sod.get_by_text("Detection probability against").first
        scroll_to(chart, 120)
        cap("Lutz' spørsmål: <b>samlet sannsynlighet for å oppdage en systematisk feil av en viss størrelse</b>. X-aksen er feilen i prosent, lik for begge nivå.", 7000)
        cap("Tynne kurver: deteksjon per nivå med nivåets egen CV og K. Tykk kurve: samlet, 1 − Π(1 − p) – minst ett nivå avviser. Ved kritisk feil: L1 59 %, L2 96 %, samlet 98,5 %.", 9000)
        cap("Stiplet: kritisk feil (TEa − 1,65·CV) og TEa. Westgards N=2-kurver forutsetter samme skift i SD på begge nivå; her regnes nivåene hver for seg og kombineres.", 8500)
        # 7 search for rules
        btn = sod.get_by_role("button", name="Search for rules").first
        scroll_to(btn, 300)
        highlight(btn)
        cap("Regelsøk: K per nivå fra 1,5 til 5,0 SD. Settet som holder samlet falsk alarm ≤ 1,5 % og gir best deteksjon velges – her K 2,5 på L1 og 3,1 på L2.", 6000)
        btn.click(); pg.wait_for_timeout(2500)
        highlight(btn, False)
        cap("Resultatet vises med samlet falsk alarm og deteksjon mot kravet.", 4000)
        # 8 LIS block
        lis = sod.get_by_text("What to enter in the LIS").first
        scroll_to(lis, 120)
        highlight(lis.locator("xpath=ancestor::div[1]"))
        cap("Hva som skal inn i LIS: nåværende mål og SD mot anbefalt. L2: mål 153,5 → 154,7, SD 1,535 → 1,160. Dagens regel: deteksjon 89 % – anbefalt: 98,5 %, falsk alarm 1,43 %.", 9000)
        highlight(lis.locator("xpath=ancestor::div[1]"), False)
        # 9 import ALT
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})"); pg.wait_for_timeout(1200)
        imp = pg.get_by_role("button", name="Import results").first
        highlight(imp)
        cap("Import: rådata direkte fra cobas infinity (Test, Control, Control lot, Instrument, Result, Target value, SD, Date, R1 lot). Her: ALT, mai 2025 – juni 2026, én fil.", 6000)
        pg.set_input_files("input[type=file]", [RAW[0]]); pg.wait_for_timeout(4000)
        highlight(imp, False)
        cap("CV, mål, enhetsavvik og nåværende LIS-mål/SD fylles inn for ALT. Testkodene (S-ALAT) oversettes automatisk.", 5500)
        alt = pg.locator("section").filter(has=pg.locator("input[value='ALT']")).first
        scroll_to(alt, 70)
        print("ALTCARD", alt.inner_text()[:600].replace("\n"," | "))
        cap("ALT etter import: CV og mål fra 14 måneder, sigma mot Rili-BÄK 11,5 %. Deteksjon per nivå og samlet som før.", 6000)
        # 10 CUSUM
        cus = alt.locator("p:text-is('CUSUM')").first
        scroll_to(cus, 120)
        cap("CUSUM per enhet: standardiserte resultater akkumuleres. Teoretisk ~2 alarmer per 1000 resultater – observert 30–50. Alarmene er drift innen lot, som enkeltregelen ikke ser.", 9000)
        pg.evaluate("window.scrollBy({top: 380, behavior: 'smooth'})"); pg.wait_for_timeout(1200)
        cap("Grafen viser C⁺ (grønn) og −C⁻ (blå) mot h = 5 SD, med alarmer markert. Lotbytter og alarmer nullstiller summen.", 7000)
        # 11 outro
        pg.evaluate("window.scrollTo({top:0, behavior:'smooth'})"); pg.wait_for_timeout(1000)
        cap("Oppsummert: reglene utledes fra egen impresisjon, nivåene vurderes hver for seg og kombineres, og verktøyet sier hva som skal inn i LIS. Kode, data og verktøy: github.com/mfkilinckaya-svg/DesignLabIQC-ClinChem", 9000)
        ctx.close(); b.close()
    webm = glob.glob(f"{OUT}/*.webm")[0]
    mp4 = f"{OUT}/DesignLabIQC-ClinChem_demo_no.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", webm, "-c:v", "libx264", "-preset", "medium", "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4], check=True)
    print(mp4, os.path.getsize(mp4))

main()
