"""Supplementary Figure S3: the tool's workflow on one measurand (sodium), annotated screenshot.

Input: figures/tool_screenshot_v1.0.png (Rule design tab, sodium card, 1280 px CSS width at 3x,
captured from tool/iqc-rule-designer-clinchem.html v1.0, top 60 px of the page header removed) and
figures/tool_screenshot_v1.0_boxes.json (element boxes in CSS px from the same capture).
Output: figures/Supplementary_Figure_S3.tif/.pdf/_preview.png."""
import json
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, Circle
from PIL import Image

SCALE, YOFF = 3, 60
ACC = "#C2410C"                      # vermilion, distinct from the tool's teal
img = Image.open("figures/tool_screenshot_v1.0.png").convert("RGB")
W, H = img.size

# boxes (CSS px, page coordinates): x, y, w, h -> number
BOXES = [
    (1, (826, 146, 131, 44)),            # Import results
    (2, (345, 522, 312, 126)),           # target, CV, offset per level
    (3, (603, 220, 393, 72), "right"),   # TEa source, value, sigma
    (4, (505, 306, 566, 48)),            # rule, false rejection, detection
    (4, (259, 662, 142, 42)),            # Search for rules
    (5, (259, 354, 272, 46)),            # LIS target / SD to enter
    (5, (1160, 519, 90, 128)),           # SD for LIS column
    (6, (258, 840, 994, 344)),           # detection against error size
]
KEY = [
    "Import the cobas infinity export (or type the values).",
    "Per level: target (lot mean), CV of the worst analyser, analyser offset.",
    "Choose the allowable total error source; sigma per level follows.",
    "Rule search: K per level, combined false rejection and detection against the requirement.",
    "Output: the target and the SD to enter so that the LIS's 1:3s rule reproduces the derived limit.",
    "Detection against the size of a systematic error, per level and combined.",
]

fig_w = 7.2
img_h = fig_w * H / W
key_h = 1.25
fig = plt.figure(figsize=(fig_w, img_h + key_h), dpi=600)
ax = fig.add_axes([0, key_h / (img_h + key_h), 1, img_h / (img_h + key_h)])
ax.imshow(img); ax.set_xlim(0, W); ax.set_ylim(H, 0); ax.axis("off")
for n, (x, y, w, h), *corner in BOXES:
    X, Y, Ww, Hh = x * SCALE, (y - YOFF) * SCALE, w * SCALE, h * SCALE
    ax.add_patch(FancyBboxPatch((X, Y), Ww, Hh, boxstyle="round,pad=0,rounding_size=18", fill=False, ec=ACC, lw=1.4))
    r = 34
    cx, cy = (X + Ww + 8, Y - 8) if corner == ["right"] else (X - 8, Y - 8)
    ax.add_patch(Circle((cx, cy), r, color=ACC, zorder=5))
    ax.text(cx, cy, str(n), color="white", ha="center", va="center", fontsize=6.5, fontweight="bold", zorder=6)

kx = fig.add_axes([0.02, 0, 0.96, key_h / (img_h + key_h)]); kx.axis("off")
flow = "cobas infinity export  →  ① import  →  ② CV, target, offset  →  ③ TEa source  →  ④ rule search  →  ⑤ target and SD in the LIS"
kx.text(0, 0.93, flow, fontsize=6.6, fontweight="bold", color="#0f172a", va="top")
for i, t in enumerate(KEY):
    col, row = i // 3, i % 3
    kx.text(0.5 * col, 0.70 - row * 0.22, f"{i + 1}  {t}", fontsize=5.6, color="#1e293b", va="top", wrap=True)
fig.savefig("figures/Supplementary_Figure_S3.tif", dpi=600, pil_kwargs={"compression": "tiff_lzw"})
fig.savefig("figures/Supplementary_Figure_S3.pdf", dpi=600)
fig.savefig("figures/Supplementary_Figure_S3_preview.png", dpi=150)
print("written", W, H)
