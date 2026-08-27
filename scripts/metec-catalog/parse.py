#!/usr/bin/env python3
"""
Розбір каталогу METEC (PDF, 34 стор.) — фото товарів і розгортки для зору.

Каталог зроблено презентацією: одна сторінка — один товар, розворот
альбомний. Текстового шару НЕМАЄ ЗОВСІМ (весь текст у кривих), тому
артикул, назву й таблицю характеристик звідси не витягти — це робить
`read.mts` зором. Тут ми беремо те, що доступно геометрично:

  - ФОТО товару: найбільша вкладена картинка сторінки, що не є підкладкою
    (панель тла займає пів сторінки) і не значком (гарантійна печатка,
    піктограми переваг праворуч);
  - РОЗГОРТКУ сторінки в PNG — її й читає модель.

Сторінки без товару (обкладинка, роздільники) впізнаємо за тим, що на них
немає жодної картинки потрібного розміру.

Запуск (venv з pymupdf і pillow):
  .venv-pdf/bin/python scripts/metec-catalog/parse.py "~/Downloads/Каталог METEC.pdf" output/metec-catalog/2026

Результат: photos/pN.jpg, pages/pN.png, index.json (поки без артикулів),
contact-sheet-N.png. Далі — read.mts (зір), publish.mts, sync.mts.
"""
import io
import json
import os
import sys

import pymupdf
from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) < 3:
    sys.exit(__doc__)
SRC, OUT = os.path.expanduser(sys.argv[1]), sys.argv[2]
os.makedirs(f"{OUT}/photos", exist_ok=True)
os.makedirs(f"{OUT}/pages", exist_ok=True)

MIN_IMAGE_PX = 200_000   # пікселів: менше — піктограма переваги чи печатка
PAGE_DPI = 130           # розгортка для зору: дрібний текст таблиці має читатись


def is_backdrop(im, page):
    """Панель тла праворуч — не товар: вона вища за 90% сторінки."""
    x0, y0, x1, y1 = im["bbox"]
    return (y1 - y0) > 0.9 * page.rect.height and (x1 - x0) > 0.3 * page.rect.width


def extract_photo(doc, xref, path):
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
    return img.size


doc = pymupdf.open(SRC)
pages = []
for pno in range(doc.page_count):
    page = doc[pno]
    candidates = [
        im
        for im in page.get_image_info(xrefs=True)
        if im.get("xref") and im["width"] * im["height"] >= MIN_IMAGE_PX and not is_backdrop(im, page)
    ]
    if not candidates:
        continue
    # Найбільша за площею у пікселях: знімок товару завжди найдетальніший.
    pick = max(candidates, key=lambda m: m["width"] * m["height"])
    photo = f"p{pno + 1}.jpg"
    size = extract_photo(doc, pick["xref"], f"{OUT}/photos/{photo}")
    sheet = f"p{pno + 1}.png"
    page.get_pixmap(dpi=PAGE_DPI).save(f"{OUT}/pages/{sheet}")
    pages.append({"page": pno + 1, "photo": photo, "sheet": sheet, "px": list(size)})

json.dump(
    {"catalogYear": "2026", "source": os.path.basename(SRC), "pages": pages},
    open(f"{OUT}/index.json", "w"),
    ensure_ascii=False,
    indent=1,
)
print(f"сторінок із товаром: {len(pages)} з {doc.page_count}")

try:
    small = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 12)
except OSError:
    small = ImageFont.load_default()
CELL_W, CELL_H, COLS, ROWS = 240, 220, 5, 4
per_sheet = COLS * ROWS
for sheet_no in range((len(pages) + per_sheet - 1) // per_sheet):
    sheet = Image.new("RGB", (CELL_W * COLS, CELL_H * ROWS), "white")
    draw = ImageDraw.Draw(sheet)
    for i, p in enumerate(pages[sheet_no * per_sheet : (sheet_no + 1) * per_sheet]):
        cx, cy = (i % COLS) * CELL_W, (i // COLS) * CELL_H
        draw.rectangle([cx, cy, cx + CELL_W - 1, cy + CELL_H - 1], outline="#ccc")
        ph = Image.open(f"{OUT}/photos/{p['photo']}")
        ph.thumbnail((CELL_W - 20, CELL_H - 50))
        sheet.paste(ph, (cx + 10, cy + 8))
        draw.text((cx + 8, cy + CELL_H - 24), f"стор.{p['page']}  {p['px'][0]}x{p['px'][1]}", fill="black", font=small)
    sheet.save(f"{OUT}/contact-sheet-{sheet_no + 1}.png")
print("контактні аркуші готові")
