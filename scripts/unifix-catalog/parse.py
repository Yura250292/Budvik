#!/usr/bin/env python3
"""
Розбір офіційного каталогу UNIFIX 2025 (PDF) у структурований індекс + фото.

Каталог влаштований інакше, ніж Grösser: це не таблиця «рядок = товар з
власним фото», а сторінки-розвороти. Є заголовок товарної лінійки, під ним
фото балона (часто пара PREMIUM + STANDART) і таблиці варіантів, де кожен
рядок має свій артикул: 951235, 951237… або SK-540512, ARM-5005 для скотчів.
Тобто одне фото дістається групі артикулів — і це нормально: у самому
каталозі всі 40 кольорів емалі стоять під одним знімком балона.

Чому не «найближче фото до таблиці»: на сторінці 30 таблиці суперхрому вгорі
належать фото з ПОПЕРЕДНЬОЇ сторінки, а фото флуоресцентної емалі посередині —
таблицям НИЖЧЕ. Тому ріжемо не по сторінці, а по секціях: секція починається
заголовком у правій колонці (кегль 12, великі літери, x ≥ 170) і триває, доки
не почнеться наступний — хоч через дві сторінки. Заголовки лівої колонки
(«… PREMIUM», «… STANDART») — це підписи таблиць усередині секції, не межі.

Розкладка всередині секції:
  - якщо у фотоблоці стільки ж картинок, скільки таблиць у секції (типовий
    випадок «дві банки — дві таблиці»), ставимо їх у пару зліва направо:
    ліва банка — PREMIUM, права — STANDART;
  - інакше кожна таблиця бере найбільшу картинку найближчого фотоблока.

Що відсіюємо:
  - бейджі й піктограми («зі збільшеним виходом») — менші за 5000 пікселів;
  - фони сторінок-роздільників — понад 70% площі сторінки;
  - широкі схеми-порівняння (сторінки 7 і 14) — ширші за 300 pt;
  - повтори артикулів: той самий 951235 стоїть і на сторінці товару, і в
    зведеній таблиці далі — лишаємо ПЕРШУ появу, вона біля фото.

Фото дістаємо вкладеною картинкою (не рендером сторінки): у рендер лізуть
бейджі й підписи, а вкладена картинка — чистий балон на прозорому тлі.
Прозорість (smask) підкладаємо білим. Роздільність каталогу невелика
(124–350 px по ширині) — це стеля джерела, догори не тягнемо.

Запуск (потрібні pymupdf і pillow; ставити в окремий venv, у проєкті їх нема):
  python3 -m venv .venv-pdf && .venv-pdf/bin/pip install pymupdf pillow
  .venv-pdf/bin/python scripts/unifix-catalog/parse.py "~/Downloads/Unifix_2025.pdf" output/unifix-catalog/2025

Результат у <outdir>: index.json, photos/pN-K.jpg, contact-sheet-N.png
(останнє — щоб перевірити оком, що фото стоїть біля свого артикула).
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

# Артикули каталогу: 951235 або SK-540512, SK50-54003001, ARM-5005BL.
ARTICLE = re.compile(r"^(?:\d{6}|[A-Z]{2,6}\d{0,3}-[A-Z0-9]{3,12})$")
# Код без хвоста-кольору («ETU-10») і словник кольорів каталогу.
COLOUR_CODE = re.compile(r"^[A-Z]{2,6}-\d{2,3}$")
COLOURS = {"white": "W", "yellow": "Y", "green": "G", "red": "R", "blue": "BL", "black": "B"}
ROW_GAP = 55         # pt: розрив між рядками, більший за який — нова таблиця
IMG_GAP = 40         # pt: розрив між картинками, більший за який — новий фотоблок
MIN_IMAGE_PX = 5000  # пікселів: менше — бейдж, а не фото
MAX_IMAGE_PT = 300   # pt по ширині: ширше — схема на всю сторінку, не товар
HEAD_SIZE = 11.5     # кегль заголовка секції
HEAD_X = 170         # заголовки лівої колонки (x ≈ 40–60) — підписи таблиць, не секції

doc = pymupdf.open(SRC)
PAGE_AREA = doc[0].rect.width * doc[0].rect.height


def is_caps(text):
    letters = [c for c in text if c.isalpha()]
    return len(letters) >= 5 and sum(c.isupper() for c in letters) >= 0.8 * len(letters)


def headings(page):
    """Заголовки секцій сторінки: (y, назва)."""
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = span["text"].strip()
                x, y = span["bbox"][0], span["bbox"][1]
                if span["size"] >= HEAD_SIZE and x >= HEAD_X and y > 45 and is_caps(text):
                    out.append((y, text))
    # заголовок у два рядки («ГРУНТОВКА АКРИЛОВА КОНЦЕНТРАТ 1:4 / ГЛИБОКОГО
    # ПРОНИКНЕННЯ») — це одна секція, а не дві
    merged = []
    for y, text in sorted(out):
        if merged and y - merged[-1][0] < 20:
            merged[-1] = (merged[-1][0], f"{merged[-1][1]} {text}")
        else:
            merged.append((y, text))
    return merged


def article_clusters(page):
    """Таблиці сторінки: [(y_першого_рядка, [(артикул, y), …]), …]."""
    words = page.get_text("words")
    colours = [(w, COLOURS[w[4].strip().lower()]) for w in words if w[4].strip().lower() in COLOURS]
    arts = []
    for w in words:
        token = w[4].strip().upper().rstrip(".,;")
        if ARTICLE.match(token):
            arts.append((token, w[1]))
            continue
        # Ізострічка: у каталозі артикул написаний двома словами («ETU-10 White»),
        # а в 1С це один код — ETU-10W. Колір і є хвостом артикулу. Шукаємо його
        # не «наступним словом», а в тій самій комірці: «ETU-20 yellow» частина
        # рядків переносить на другий рядок, і між ними встряють сусідні колонки.
        if COLOUR_CODE.match(token):
            near = [
                (c, suffix)
                for c, suffix in colours
                if -4 < c[1] - w[1] < 16 and -10 < c[0] - w[0] < 60
            ]
            if near:
                arts.append((token + min(near, key=lambda n: n[0][1] - w[1])[1], w[1]))
    arts.sort(key=lambda a: a[1])
    clusters, current = [], []
    for a in arts:
        if current and a[1] - current[-1][1] > ROW_GAP:
            clusters.append(current)
            current = []
        current.append(a)
    if current:
        clusters.append(current)
    return [(c[0][1], c) for c in clusters]


def photo_blocks(page):
    """Фотоблоки сторінки: картинки, згруповані по вертикалі, зліва направо."""
    images = []
    for im in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = im["bbox"]
        if not im.get("xref"):
            continue
        if im["width"] * im["height"] < MIN_IMAGE_PX:
            continue
        if (x1 - x0) * (y1 - y0) > 0.7 * PAGE_AREA:
            continue
        if x1 - x0 > MAX_IMAGE_PT or x1 - x0 < 25 or y1 - y0 < 25:
            continue
        images.append(im)
    images.sort(key=lambda m: m["bbox"][1])
    blocks, current = [], []
    for im in images:
        if current and im["bbox"][1] - max(c["bbox"][3] for c in current) > IMG_GAP:
            blocks.append(current)
            current = []
        current.append(im)
    if current:
        blocks.append(current)
    out = []
    for b in blocks:
        b.sort(key=lambda m: m["bbox"][0])
        centre = (min(m["bbox"][1] for m in b) + max(m["bbox"][3] for m in b)) / 2
        out.append((centre, b))
    return out


def row_text(page, y):
    """Текст рядка таблиці на цій висоті — щоб було видно, що це за товар."""
    words = [w for w in page.get_text("words") if abs(w[1] - y) < 4]
    words.sort(key=lambda w: w[0])
    return " ".join(w[4] for w in words).strip()


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


# ── 1. збираємо секції наскрізь по документу ────────────────────────────────
sections = []
for pno in range(doc.page_count):
    page = doc[pno]
    items = (
        [(y, 0, ("head", title)) for y, title in headings(page)]
        + [(y, 1, ("photos", block)) for y, block in photo_blocks(page)]
        + [(y, 2, ("table", cluster)) for y, cluster in article_clusters(page)]
    )
    for _, _, (kind, payload) in sorted(items, key=lambda i: (i[0], i[1])):
        if kind == "head":
            sections.append({"title": payload, "page": pno + 1, "photos": [], "tables": []})
        elif sections:
            key = "photos" if kind == "photos" else "tables"
            sections[-1][key].append({"page": pno + 1, "data": payload})

# ── 2. кожній таблиці — своє фото ───────────────────────────────────────────
def global_y(entry, use_centre=False):
    data = entry["data"]
    y = data[0][1] if not use_centre else (
        min(m["bbox"][1] for m in data) + max(m["bbox"][3] for m in data)
    ) / 2
    return entry["page"] * 1000 + y


groups, rows, seen = [], [], set()
on_page = {}  # скільки таблиць уже пронумеровано на цій сторінці
for section in sections:
    tables, blocks = section["tables"], section["photos"]
    paired = None
    for block in blocks:
        if len(tables) > 1 and len(block["data"]) == len(tables):
            paired = block  # «дві банки — дві таблиці»: ліва PREMIUM, права STANDART
    for idx, table in enumerate(tables):
        pick = None
        if paired:
            pick = paired["data"][idx]
        elif blocks:
            ty = global_y(table)
            nearest = min(blocks, key=lambda b: abs(global_y(b, True) - ty))
            pick = max(nearest["data"], key=lambda m: m["width"] * m["height"])
        fresh = [a for a in table["data"] if a[0] not in seen]
        if not fresh:
            continue  # зведена таблиця: артикули вже мають фото зі своєї сторінки
        # Номер — у межах СТОРІНКИ, а не секції й не наскрізний. У межах секції
        # він не унікальний (на сторінці 47 дві секції, і «p47-0» від обох
        # перетирало б фото одне одному), а наскрізний зсувається весь, щойно
        # десь на початку каталогу додасться таблиця, — і посилання, які вже
        # стоять у картках товарів, почали б показувати чуже фото.
        page_no = table["page"]
        gid = f"p{page_no}-{on_page.get(page_no, 0)}"
        on_page[page_no] = on_page.get(page_no, 0) + 1
        photo = None
        if pick:
            photo = f"{gid}.jpg"
            extract_photo(pick["xref"], f"{OUT}/photos/{photo}")
        groups.append(
            {
                "id": gid,
                "page": table["page"],
                "section": section["title"],
                "photo": photo,
                "px": [pick["width"], pick["height"]] if pick else None,
                "articles": [a[0] for a in fresh],
            }
        )
        for art, y in fresh:
            seen.add(art)
            rows.append(
                {
                    "article": art,
                    "page": table["page"],
                    "group": gid,
                    "section": section["title"],
                    "photo": photo,
                    "row": row_text(doc[table["page"] - 1], y),
                }
            )

json.dump(
    {"catalogYear": "2025", "source": os.path.basename(SRC), "groups": groups, "rows": rows},
    open(f"{OUT}/index.json", "w"),
    ensure_ascii=False,
    indent=1,
)

print(f"секцій: {len(sections)} | груп: {len(groups)} | артикулів: {len(rows)}")
print(f"артикулів з фото: {sum(1 for r in rows if r['photo'])} | груп без фото: {sum(1 for g in groups if not g['photo'])}")
for g in groups:
    if not g["photo"]:
        print(f"   без фото: {g['id']} «{g['section']}» {g['articles'][:6]}")

# ── 3. контактні аркуші: фото + артикули групи, щоб перевірити оком ─────────
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
            ph.thumbnail((CELL_W - 20, 150))
            sheet.paste(ph, (cx + 10, cy + 8))
        else:
            draw.text((cx + 10, cy + 60), "БЕЗ ФОТО", fill="red", font=font)
        text = f"{g['id']} стор.{g['page']}\n{g['section'][:42]}\n" + ", ".join(g["articles"][:8])
        draw.multiline_text((cx + 8, cy + 165), text[:220], fill="black", font=small, spacing=2)
    sheet.save(f"{OUT}/contact-sheet-{sheet_no + 1}.png")
print(f"контактних аркушів: {sheets}")
