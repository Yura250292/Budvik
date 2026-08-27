#!/usr/bin/env python3
"""
Розбір каталогу «12 Atelie 2026» (PDF) у структурований індекс + фото.

Каталог зверстаний регулярною сіткою: 3–4 колонки, у колонці один-два
товарні блоки, над блоком — фото. Усередині блоку дві форми верстки:

  А. один товар: угорі жирний артикул (6 цифр), під ним назва, далі
     пункти «•» (переваги) або рядок «Комплектація: …»;
  Б. лінійка варіантів: спершу назва («Щітка склоочисника безкаркасна»),
     під нею стовпчик жирних артикулів, у кожного праворуч свій розмір
     («13’/330 мм»), а внизу спільний абзац опису дрібнішим кеглем.

Тому блок шукаємо не по колонках (на сторінці 5 нижній ряд зсунутий:
34/213/392 замість 34/168/302/436), а кластеризацією спанів: спан іде в
той самий блок, якщо починається не лівіше за блок і не далі як на 60 pt
праворуч (відступ пункту — 6 pt, колонка розміру — 50 pt), а вертикальний
розрив до попереднього рядка не більший за 30 pt. Сусідня колонка стоїть
за 134 pt, наступний блок у колонці — за 150+ pt, тож межі чіткі.

Фото беремо вкладеною картинкою (не рендером сторінки — у рендер лізуть
бейджі «NEW» і кружечки «i»), найближчу НАД блоком з перетином по x.
Один знімок часто стоїть на кілька блоків (шторка 130×60 і 145×70 — те
саме фото); файл кладемо один на xref, а назву даємо за першим артикулом
блока — так посилання в картці не поїде від переверстки каталогу.

Запуск (venv з pymupdf і pillow — у проєкті їх нема):
  .venv-pdf/bin/python scripts/atelie-catalog/parse.py "~/Downloads/Каталог 12 Atelie 2026.pdf" output/atelie-catalog/2026

Результат у <outdir>: index.json, photos/<артикул>.jpg, contact-sheet-N.png.
Далі — publish.mts і sync.mts.
"""
import io
import json
import os
import re
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) < 3:
    sys.exit(__doc__)
SRC, OUT = os.path.expanduser(sys.argv[1]), sys.argv[2]
os.makedirs(f"{OUT}/photos", exist_ok=True)

# Артикули каталогу шестизначні (951607), але лінійка автохімії на стор. 14
# має п'ятизначні (84827) — і набрана іншим накресленням (GothamPro-Black).
ARTICLE = re.compile(r"^\d{5,6}$")
FOOTER_Y = 795        # pt: нижче — колонтитул «12atelie.com»
HEAD_SIZE = 14        # кегль назви розділу («Шторки сонцезахисні»)
BLOCK_DX = 60         # pt: наскільки правіше за початок блока може бути спан
BLOCK_DX_LEFT = 14    # pt: і наскільки лівіше (артикул зсунутий від назви —
                      # на стор. 14 аж на 8 pt, і з допуском 8 назва
                      # відколювалась в окремий блок без артикула)
BLOCK_DY = 30         # pt: розрив між рядками, більший за який — новий блок
MIN_IMAGE_PX = 20000  # пікселів: менше — бейдж «NEW» чи кружечок «i»
MIN_IMAGE_PT = 40     # pt: вужча картинка — піктограма
COLUMN_W = 130        # pt: ширина колонки верстки — нею міряємо перекриття з фото
PHOTO_OVERLAP = 60    # pt: наскільки фото може підлазити під верх блока
PHOTO_REACH = 300     # pt: далі вгору не тягнемось — то фото чужого блока
PHOTO_BAND = 20       # pt: знімки в межах цієї смуги вважаємо одним рядом

doc = pymupdf.open(SRC)
PAGE_AREA = doc[0].rect.width * doc[0].rect.height


def spans_of(page):
    """Текстові спани сторінки без колонтитула, зверху вниз."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = span["text"].replace("\t", " ").strip()
                if not text or span["bbox"][1] > FOOTER_Y:
                    continue
                # Врізки-підказки («i» у кружечку) набрані GothamPro-Medium
                # синім і стоять між колонками: прив'язати їх до конкретного
                # товару неможливо, а в пункти вони злипаються з сусідніми.
                if "Medium" in span["font"] or (span["size"] < 6 and "Bold" in span["font"]):
                    continue
                out.append(
                    {
                        "text": text,
                        "x": span["bbox"][0],
                        "y": span["bbox"][1],
                        "size": span["size"],
                        "bold": "Bold" in span["font"] or "Black" in span["font"],
                    }
                )
    out.sort(key=lambda s: (round(s["y"], 1), s["x"]))
    return out


def photos_of(page):
    """Товарні картинки сторінки (без бейджів і фонів)."""
    out = []
    for im in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = im["bbox"]
        if not im.get("xref") or im["width"] * im["height"] < MIN_IMAGE_PX:
            continue
        if (x1 - x0) * (y1 - y0) > 0.7 * PAGE_AREA or x1 - x0 < MIN_IMAGE_PT:
            continue
        out.append(im)
    return out


def build_blocks(spans):
    """Спани → блоки: [{x, y, spans:[…]}]. Див. правило в докстрінгу."""
    blocks = []
    for span in spans:
        best = None
        for block in blocks:
            if span["y"] - block["last_y"] > BLOCK_DY:
                continue
            if not (block["x"] - BLOCK_DX_LEFT <= span["x"] <= block["x"] + BLOCK_DX):
                continue
            gap = abs(span["x"] - block["x"])
            if best is None or gap < best[0]:
                best = (gap, block)
        if best is None:
            blocks.append({"x": span["x"], "y": span["y"], "last_y": span["y"], "spans": [span]})
        else:
            block = best[1]
            block["spans"].append(span)
            block["x"] = min(block["x"], span["x"])
            block["last_y"] = max(block["last_y"], span["y"])
    return blocks


def parse_block(block):
    """Блок → {title, articles:[{article, variant}], bullets, note}."""
    spans = sorted(block["spans"], key=lambda s: (round(s["y"], 1), s["x"]))
    arts = [s for s in spans if s["bold"] and ARTICLE.match(s["text"])]
    if not arts:
        return None
    first_art_y = arts[0]["y"]
    body = [s for s in spans if s not in arts]

    # Форма Б: назва стоїть НАД першим артикулом. Форма А: назва під ним.
    head = [s for s in body if s["y"] < first_art_y - 2]
    title_spans = head if head else [s for s in body if s["y"] > first_art_y]

    title, bullets, note = [], [], []
    started_bullets = False
    for span in title_spans:
        text = span["text"]
        if text.startswith("•"):
            started_bullets = True
            bullets.append(text.lstrip("•").strip())
            continue
        if started_bullets:
            # продовження пункту з переносом рядка
            if bullets:
                bullets[-1] = f"{bullets[-1]} {text}".strip()
            continue
        if head and span["size"] < 8.6:
            note.append(text)          # спільний абзац лінійки варіантів
        elif not head and span["size"] < 8.6:
            note.append(text)
        else:
            title.append(text)

    articles = []
    for art in arts:
        variant = [
            s["text"]
            for s in body
            if s["x"] > art["x"] + 20 and abs(s["y"] - art["y"]) < 9 and s["size"] >= 8.6
        ]
        articles.append({"article": art["text"], "variant": " ".join(variant).strip()})

    return {
        "title": " ".join(title).strip(),
        "articles": articles,
        "bullets": [b for b in bullets if b],
        "note": re.sub(r"\s+", " ", " ".join(note).replace("­", "")).strip(),
        "top": min(s["y"] for s in spans),
        "x0": block["x"],
    }


def extract_photo(xref, path):
    """Вкладена картинка → JPEG на білому тлі (прозорість підкладаємо)."""
    raw = doc.extract_image(xref)
    img = Image.open(io.BytesIO(raw["image"])).convert("RGBA")
    smask = raw.get("smask")
    if smask:
        mask = Image.open(io.BytesIO(doc.extract_image(smask)["image"])).convert("L")
        if mask.size != img.size:
            mask = mask.resize(img.size, Image.LANCZOS)
        img.putalpha(mask)
    canvas = Image.new("RGB", img.size, "white")
    canvas.paste(img, (0, 0), img)
    canvas.save(path, quality=92)


groups, rows, seen, by_xref = [], [], set(), {}
for pno in range(doc.page_count):
    page = doc[pno]
    spans = spans_of(page)
    section = ""
    heads = sorted([s for s in spans if s["size"] >= HEAD_SIZE], key=lambda s: s["y"])
    images = photos_of(page)

    parsed = [p for p in (parse_block(b) for b in build_blocks(spans)) if p]
    parsed.sort(key=lambda p: (round(p["top"] / 100), p["x0"]))

    for item in parsed:
        above = [h["text"] for h in heads if h["y"] < item["top"]]
        section = above[-1] if above else section
        fresh = [a for a in item["articles"] if a["article"] not in seen]
        if not fresh:
            continue

        # Фото: найкраще перекриття з колонкою блока серед тих, що стоять над
        # ним. «Над» рахуємо по центру картинки, а не по нижньому краю: на
        # сторінках 7–8 знімки широкі й підлазять під артикул на 20 pt, а
        # сусідні знімки в ряду перекриваються між собою по горизонталі —
        # тому вибір за нижнім краєм там дає нічию і хапає чужу колонку.
        column = (item["x0"], item["x0"] + COLUMN_W)
        candidates = []
        for im in images:
            x0, y0, x1, y1 = im["bbox"]
            if (y0 + y1) / 2 >= item["top"] or y1 > item["top"] + PHOTO_OVERLAP:
                continue
            if y1 < item["top"] - PHOTO_REACH:
                continue
            overlap = min(x1, column[1]) - max(x0, column[0])
            if overlap > 0.3 * min(x1 - x0, COLUMN_W):
                candidates.append((round(y1 / PHOTO_BAND), overlap, im))
        # Спершу — найближче над блоком, і лише в межах одного ряду (±20 pt)
        # вибираємо за перекриттям. Навпаки не можна: на стор. 16 знімок
        # зарядного з ВЕРХНЬОГО ряду перекриває колонку краще (він ширший),
        # ніж свій компресор, і компресори отримували фото зарядних.
        pick = max(candidates, key=lambda c: (c[0], c[1]))[2] if candidates else None

        gid = fresh[0]["article"]
        photo = None
        if pick:
            photo = by_xref.get(pick["xref"])
            if not photo:
                photo = f"{gid}.jpg"
                extract_photo(pick["xref"], f"{OUT}/photos/{photo}")
                by_xref[pick["xref"]] = photo

        groups.append(
            {
                "id": gid,
                "page": pno + 1,
                "section": section,
                "title": item["title"],
                "photo": photo,
                "px": [pick["width"], pick["height"]] if pick else None,
                "bullets": item["bullets"],
                "note": item["note"],
                "articles": [a["article"] for a in fresh],
            }
        )
        for art in fresh:
            seen.add(art["article"])
            rows.append(
                {
                    "article": art["article"],
                    "page": pno + 1,
                    "group": gid,
                    "section": section,
                    "title": item["title"],
                    "variant": art["variant"],
                    "bullets": item["bullets"],
                    "note": item["note"],
                    "photo": photo,
                }
            )

json.dump(
    {"catalogYear": "2026", "source": os.path.basename(SRC), "groups": groups, "rows": rows},
    open(f"{OUT}/index.json", "w"),
    ensure_ascii=False,
    indent=1,
)

print(f"груп: {len(groups)} | артикулів: {len(rows)} | фото-файлів: {len(by_xref)}")
print(f"артикулів з фото: {sum(1 for r in rows if r['photo'])} | груп без фото: {sum(1 for g in groups if not g['photo'])}")
for g in groups:
    if not g["photo"]:
        print(f"   без фото: {g['id']} стор.{g['page']} «{g['title'][:50]}»")

try:
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 13)
    small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 11)
except OSError:
    font = small = ImageFont.load_default()

CELL_W, CELL_H, COLS, ROWS_PER_SHEET = 300, 260, 4, 5
per_sheet = COLS * ROWS_PER_SHEET
sheets = (len(groups) + per_sheet - 1) // per_sheet
for sheet_no in range(sheets):
    sheet = Image.new("RGB", (CELL_W * COLS, CELL_H * ROWS_PER_SHEET), "white")
    draw = ImageDraw.Draw(sheet)
    for i, g in enumerate(groups[sheet_no * per_sheet : (sheet_no + 1) * per_sheet]):
        cx, cy = (i % COLS) * CELL_W, (i // COLS) * CELL_H
        draw.rectangle([cx, cy, cx + CELL_W - 1, cy + CELL_H - 1], outline="#ccc")
        if g["photo"]:
            ph = Image.open(f"{OUT}/photos/{g['photo']}")
            ph.thumbnail((CELL_W - 20, 140))
            sheet.paste(ph, (cx + 10, cy + 8))
        else:
            draw.text((cx + 10, cy + 60), "БЕЗ ФОТО", fill="red", font=font)
        text = f"стор.{g['page']} {g['section'][:34]}\n{g['title'][:70]}\n" + ", ".join(g["articles"][:8])
        draw.multiline_text((cx + 8, cy + 155), text[:230], fill="black", font=small, spacing=2)
    sheet.save(f"{OUT}/contact-sheet-{sheet_no + 1}.png")
print(f"контактних аркушів: {sheets}")
