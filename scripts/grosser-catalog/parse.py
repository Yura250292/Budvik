#!/usr/bin/env python3
"""
Розбір офіційного каталогу Grösser (PDF, зроблений з Excel) у структурований
індекс + фото товарів.

Навіщо окремий парсер: каталог — це таблиця «Артикул | Модель | Характеристики
| Фото | ОПТ | РРЦ», де характеристики і фото — картинки, а не текст. Рядки
розрізняються лише координатами, тому текст витягаємо з позиціями (PyMuPDF),
ріжемо сторінку на рядки по артикулах (G0362) і кожній картинці шукаємо рядок
за центром по вертикалі.

Як відрізнити фото від таблиці характеристик: таблиця стоїть у колонці
«Характеристики» (x 140–300 pt), фото — правіше (починається від x ≥ 220) або
широке і доходить до x ≥ 330. Серед картинок рядка, що заходять у колонку «Фото», беремо
найбільшу за площею — дрібні бейджі («Безщітковий двигун», «Top speed»)
відсіюються і площею, і положенням. Одне фото в каталозі часто стоїть на
кілька рядків (варіанти GCD 520/520Q/520T, ланцюги, шини) — це нормально,
повторювані картинки НЕ відкидаємо; логотипи вирізаємо явним списком за
розміром (шапка 635×105 і логотип Grösser 408×97).

Запуск (потрібні pymupdf і pillow; ставити в окремий venv, у проєкті їх нема):
  python3 -m venv .venv-pdf && .venv-pdf/bin/pip install pymupdf pillow
  .venv-pdf/bin/python scripts/grosser-catalog/parse.py "<каталог>.pdf" output/grosser-catalog/2026-06-17

Результат у <outdir>: index.json, photos/G0362.jpg, specs/G0362.png,
contact-sheet-N.png (для перевірки оком). Далі — publish.mts і sync.mts.
"""
import collections
import json
import os
import re
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) < 3:
    sys.exit(__doc__)
SRC, OUT = sys.argv[1], sys.argv[2]
os.makedirs(f"{OUT}/photos", exist_ok=True)
os.makedirs(f"{OUT}/specs", exist_ok=True)
doc = pymupdf.open(SRC)

ART = re.compile(r"^[A-Z]\d{4}[A-Za-z]?$")  # G0362
# Таблиця характеристик починається на x≈140–160 і тягнеться щонайбільше до
# x≈300; фото стоїть правіше (x0 ≥ 220) або, коли широке (тримери, штанги,
# складені «таблиця+фото» на бензотехніці), доходить до x ≥ 330.
PHOTO_X0_MIN = 220
PHOTO_X1_MIN = 330
SPEC_X1_MAX = 320
HEADER_Y = 75       # нижче шапки таблиці


def is_logo(info):
    """Шапка сторінки і логотип Grösser у колонці «Модель» — за розміром пікселів."""
    w, h = info["width"], info["height"]
    return (w, h) in {(635, 105), (408, 97)}


def spans_of(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for s in line["spans"]:
                t = s["text"].strip()
                if t:
                    x0, y0, x1, y1 = s["bbox"]
                    out.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1, "cy": (y0 + y1) / 2, "t": t})
    return out


def num(s):
    """'14 625' → 14625, '$27,0' → 27.0"""
    if s is None:
        return None
    s = s.replace("$", "").replace(" ", "").replace(",", ".")
    try:
        return float(s) if "." in s else int(s)
    except ValueError:
        return None


rows = []
for pno, page in enumerate(doc):
    spans = spans_of(page)
    arts = sorted([s for s in spans if s["x0"] < 55 and ART.match(s["t"])], key=lambda s: s["cy"])
    if not arts:
        print(f"стор. {pno + 1}: артикулів не знайдено", file=sys.stderr)
        continue
    centers = [a["cy"] for a in arts]
    images = [i for i in page.get_image_info(xrefs=True) if not is_logo(i)]
    for i, a in enumerate(arts):
        top = HEADER_Y if i == 0 else (centers[i - 1] + centers[i]) / 2
        bot = page.rect.height if i == len(arts) - 1 else (centers[i] + centers[i + 1]) / 2
        inrow = [s for s in spans if top <= s["cy"] < bot and s is not a]
        model_col = sorted([s for s in inrow if 55 <= s["x0"] < 140], key=lambda s: (s["y0"], s["x0"]))
        spec_col = sorted([s for s in inrow if 140 <= s["x0"] < 330], key=lambda s: (s["y0"], s["x0"]))
        right = [s for s in inrow if s["x0"] >= 330]

        model, desc, after_rule = [], [], False
        for s in model_col:
            if re.fullmatch(r"_+", s["t"]):
                after_rule = True
                continue
            (desc if after_rule else model).append(s["t"])
        pack = next((int(m.group(1)) for s in right for m in [re.fullmatch(r"\[(\d+)\]", s["t"])] if m), None)
        opt = next((s["t"] for s in right if s["t"].startswith("$")), None)
        rrc = next((s["t"] for s in right if s["x0"] > 500 and re.fullmatch(r"[\d ]+", s["t"])), None)
        has_photo_mark = any(s["t"] == "+" for s in right)

        cands = []
        for info in images:
            x0, y0, x1, y1 = info["bbox"]
            cy = (y0 + y1) / 2
            w, h = x1 - x0, y1 - y0
            if not (top <= cy < bot) or w < 30 or h < 20 or w * h < 2000:
                continue
            cands.append({"xref": info["xref"], "x0": x0, "x1": x1, "area": w * h})
        photo = max((c for c in cands if c["x1"] >= PHOTO_X1_MIN or c["x0"] >= PHOTO_X0_MIN), key=lambda c: c["area"], default=None)
        if photo is None and len(cands) == 1 and cands[0]["x1"] >= 280:
            # Єдина картинка рядка, що сягає колонки «Фото» (коротка шина 8"):
            # таблиці характеристик тут нема, тож це фото.
            photo = cands[0]
        spec = max((c for c in cands if c is not photo and c["x1"] < SPEC_X1_MAX and c["area"] >= 3000), key=lambda c: c["area"], default=None)

        rows.append({
            "page": pno + 1,
            "article": a["t"],
            "model": " ".join(model),
            "kind": " ".join(desc),          # тип товару з-під моделі: «Робот-газонокосарка»
            "specText": " ".join(s["t"] for s in spec_col),
            "photoMark": has_photo_mark,       # колонка «Фото»: «+» у постачальника є фото
            # [N] у каталозі — кількість у ящику, НЕ кратність замовлення (див. pack-qty у проєкті)
            "boxQty": pack,
            "optUsd": num(opt),
            "rrcUah": num(rrc),
            "_photo": photo,
            "_spec": spec,
        })


def pixmap(xref):
    pix = pymupdf.Pixmap(doc, xref)
    smask = doc.xref_get_key(xref, "SMask")
    if smask[0] == "xref":
        pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(doc, int(smask[1].split()[0])))
    if pix.n - pix.alpha >= 4:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    return pix


def to_pil(pix):
    mode = "RGBA" if pix.alpha else "RGB"
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples)


cache = {}
for r in rows:
    photo, spec = r.pop("_photo"), r.pop("_spec")
    r["photo"] = r["spec"] = None
    if photo:
        im = cache.get(photo["xref"])
        if im is None:
            im = to_pil(pixmap(photo["xref"]))
            if im.mode == "RGBA":  # фото з прозорістю — на білий фон, як на сайті
                bg = Image.new("RGBA", im.size, "white")
                bg.alpha_composite(im)
                im = bg
            im = im.convert("RGB")
            cache[photo["xref"]] = im
        fn = f"photos/{r['article']}.jpg"
        im.save(f"{OUT}/{fn}", quality=90, optimize=True)
        r["photo"] = fn
        r["photoPx"] = list(im.size)
    if spec:
        fn = f"specs/{r['article']}.png"
        to_pil(pixmap(spec["xref"])).save(f"{OUT}/{fn}", optimize=True)
        r["spec"] = fn

index = {
    "source": os.path.basename(SRC),
    "rows": rows,
}
with open(f"{OUT}/index.json", "w") as f:
    json.dump(index, f, ensure_ascii=False, indent=1)

# Контрольні листи: вибрані фото з підписами — єдиний спосіб перевірити, що
# рядок отримав саме своє фото, а не таблицю чи сусіда.
with_photo = [r for r in rows if r["photo"]]
COLS, CW, CH, PER = 8, 180, 170, 48
font = ImageFont.load_default()
for n, start in enumerate(range(0, len(with_photo), PER)):
    chunk = with_photo[start:start + PER]
    sheet = Image.new("RGB", (COLS * CW, ((len(chunk) + COLS - 1) // COLS) * CH), "white")
    d = ImageDraw.Draw(sheet)
    for k, r in enumerate(chunk):
        im = Image.open(f"{OUT}/{r['photo']}")
        im.thumbnail((CW - 10, CH - 30))
        x, y = (k % COLS) * CW, (k // COLS) * CH
        sheet.paste(im, (x + 5, y + 5))
        d.text((x + 5, y + CH - 22), f"{r['article']} {r['model'][:18]}", fill="black", font=font)
    sheet.save(f"{OUT}/contact-sheet-{n}.png")

dups = [a for a, c in collections.Counter(r["article"] for r in rows).items() if c > 1]
print(f"рядків: {len(rows)}, з фото: {len(with_photo)}, з таблицею характеристик: {sum(1 for r in rows if r['spec'])}, дублі артикулів: {dups or 'немає'}")
for r in rows:
    if not r["photo"]:
        print(f"  без фото: стор. {r['page']} {r['article']} {r['model']} — {r['kind'][:40]}")
