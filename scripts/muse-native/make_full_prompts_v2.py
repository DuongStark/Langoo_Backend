from __future__ import annotations

import json
import random
from pathlib import Path

ROOT = Path(r"C:\Users\PC\Desktop\muse-native")
V3 = Path(r"C:\Users\PC\Desktop\Langoo-Gemini\all-prompts-20261108-v3-policy")
PILOT = ROOT / "pilot-100-antislop" / "pilot-prompts.jsonl"
VALIDATION = ROOT / "validation-24" / "prompts.jsonl"
OUT = ROOT / "full-prompts-v2"
OUT.mkdir(exist_ok=True)

PHOTO_NATURAL = "A quick unedited photograph taken on an ordinary mid-range phone in normal photo mode. Use believable everyday surroundings and available light, natural colors, modest contrast and saturation, slightly soft fine detail. Use a simple, incidental composition with ordinary materials, believable scale and a useful but uncluttered background. Avoid glossy plastic surfaces, excessive symmetry, decorative props, perfect showroom staging, teal-orange grading, glowing edges and hyper-detailed textures. Prefer the object, food, place or visible result alone. Include a person only when the exact dictionary meaning cannot be communicated clearly without one; never add people for atmosphere, scale or decoration. When human action is essential, show only the minimum necessary body area, preferably a natural hand or partial figure, with no posed face, eye contact or staged smile. Do not crop away information needed to distinguish the meaning. No commercial polish, cinematic lighting, HDR, beauty retouching, exaggerated reactions, artificial background blur, captions, labels, logos, watermarks, or collage. Do not deliberately add blur, dirt, aging, or noise. The exact meaning must remain easy to recognize at thumbnail size."
STYLE_TEXT = {
    "photo_natural": PHOTO_NATURAL,
    "photo_window": "candid photo in soft window light, natural depth of field, everyday interior with ordinary objects; no studio staging or stock look",
    "photo_documentary": "candid documentary or street-style photo, available light, unposed everyday moment, natural colors and modest detail; no commercial polish",
    "photo_studio": "clean simple still-life photo on a neutral seamless background, soft diffused light, believable ordinary object; no glossy product-ad look or heavy retouching",
    "photo_film": "35mm analog film photo, natural grain, muted natural colors, available light, simple everyday scene; no cinematic grading or digital gloss",
    "cartoon": "clean 2D cartoon illustration, flat solid colors, simple rounded shapes, bold clean outlines, minimal shading; no corporate vector look, no gradients or gloss",
    "handdrawn": "hand-drawn pencil and ink sketch on plain paper, visible line work, light hatching, simple background; no digital gloss",
    "watercolor": "soft watercolor illustration on textured paper, gentle color washes, loose edges, simple background; no heavy digital effects",
    "flatvector": "flat vector illustration, geometric shapes, limited palette, clean minimal background; no gradients, gloss or corporate icon look",
    "comic": "simple comic-book panel, bold ink lines, flat color, light halftone; no speech bubbles",
    "clay": "soft matte 3D clay or toy render, rounded shapes, simple plain background; no glossy plastic",
    "minimal": "minimal black line art on off-white background, one clear subject, simple shapes, no shading",
    "ink": "loose ink-wash illustration, expressive brush lines, limited muted colors, textured paper, simple background; no digital gloss",
    "pastel": "soft pastel or chalk illustration, gentle pigment texture, muted colors, simple background; no glossy digital look",
}
REALISTIC = ["photo_natural", "photo_window", "photo_documentary", "photo_studio", "photo_film"]
ILLUSTRATIVE = ["cartoon", "handdrawn", "watercolor", "flatvector", "comic", "clay", "minimal", "ink", "pastel"]
CAMERAS = [
    "eye-level medium shot", "top-down flat lay", "close-up detail",
    "wide environmental shot", "three-quarter angle", "low-angle shot", "overhead view",
]
LIGHTS = [
    "soft overcast daylight", "warm indoor lamplight", "window light",
    "neutral diffused light", "golden-hour light", "cool morning light", "soft shadowless light",
]
GLOBAL = "Square 1:1 512x512. One clear subject per image, exact everyday meaning, simple uncluttered background, recognizable at thumbnail size. No text, labels, logos, watermarks or collage. No stock/cinematic/HDR/beauty-retouch look."

existing = set()
for path in (PILOT, VALIDATION):
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        for item in json.loads(line)["items"]:
            existing.add(item["sense_id"])

records = []
for name in ("prompts-direct-ready.jsonl", "prompts-direct-extra.jsonl"):
    for line in (V3 / name).read_text(encoding="utf-8").splitlines():
        if line.strip():
            records.append(json.loads(line))
items = {}
for record in records:
    for item in record["items"]:
        if item["sense_id"] in existing:
            continue
        items.setdefault(item["sense_id"], item)
by_lang = {"en": [], "ja": []}
for item in items.values():
    by_lang.setdefault(item["lang"], []).append(item)

rng = random.Random(20261109)
for lang in by_lang:
    rng.shuffle(by_lang[lang])

# Build a 50/50 style assignment list, then shuffle so language groups don't get one style block.
style_assignments = []
for index in range(564):
    style_assignments.append(REALISTIC[index % len(REALISTIC)])
for index in range(564):
    style_assignments.append(ILLUSTRATIVE[index % len(ILLUSTRATIVE)])
rng.shuffle(style_assignments)

prompts = []
style_counter = {style: 0 for style in STYLE_TEXT}
for lang in ("en", "ja"):
    rows = by_lang[lang]
    for start in range(0, len(rows), 8):
        group = rows[start:start + 8]
        style = style_assignments[len(prompts)]
        style_counter[style] += 1
        lines = []
        for n, item in enumerate(group, 1):
            reading = f"{item['reading']}, {item['pos']}" if item.get("reading") else item["pos"]
            camera = rng.choice(CAMERAS)
            light = rng.choice(LIGHTS)
            lines.append(
                f"{n}. {item['lang'].upper()} | {item['lemma']} ({reading}) | {item['gloss']} | camera: {camera} | light: {light}"
            )
        prompt = (
            f"Generate exactly {len(group)} separate square 1:1 512x512 images, one for each numbered vocabulary item below. "
            f"Do not make variations or a collage. Keep the same order. No text, labels, logos or watermarks. "
            f"Illustrate the exact meaning, not just the word. The gloss is the exact sense; do not choose another common meaning. "
            f"Use a different everyday situation for each item; follow each item's camera and lighting; do not repeat the same background, table, cup, close-up or smiling person across items. "
            f"Style: {STYLE_TEXT[style]}. {GLOBAL}\n\n" + "\n".join(lines) +
            f"\n\nReturn all {len(group)} images in the same order."
        )
        prompts.append({
            "prompt_id": f"full2-{lang}-{start // 8 + 1:04d}",
            "lang": lang,
            "style": style,
            "items": group,
            "prompt": prompt,
        })

with (OUT / "prompts.jsonl").open("w", encoding="utf-8") as fh:
    for record in prompts:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
summary = {
    "images": sum(len(r["items"]) for r in prompts),
    "prompts": len(prompts),
    "styles": style_counter,
    "realistic_prompts": sum(1 for r in prompts if r["style"] in REALISTIC),
    "illustrative_prompts": sum(1 for r in prompts if r["style"] in ILLUSTRATIVE),
    "existing_excluded": len(existing),
    "by_language": {lang: sum(len(r["items"]) for r in prompts if r["lang"] == lang) for lang in ("en", "ja")},
}
(OUT / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(summary, ensure_ascii=False, indent=2))
