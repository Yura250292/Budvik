#!/usr/bin/env python3
"""
Розбір каталогу «СИЛА 2026 весна-літо» (PDF, 104 стор.) у індекс + фото.

Верстка вільніша, ніж у 12 Atelie: сітки колонок немає, товарні клітинки
стоять як лягло. Але всередині клітинки все стабільно:

  - НАЗВА — GothamPro-Black, кегль 8, великими літерами, у 1–3 рядки;
  - АРТИКУЛ — GothamPro-Black, кегль 6, шість цифр;
  - опис-проза — GothamPro, кегль 7 («Лещата слюсарні призначені…»);
  - варіант і фасування — GothamPro-Light, кегль 6 («120 мм», «В ящику: 50 шт.»).

Дві форми клітинки:
  А. один товар: фото, під ним назва, під назвою артикул і розмір;
  Б. лінійка розмірів: фото, назва ПРАВОРУЧ від фото, а під фото — таблиця
     («320425 | 300 мм | 60»), де кожен рядок — свій артикул.

Через форму Б артикул не можна віддавати «найближчій назві»: артикул 320425
стоїть за 130 pt від назви ОБЦЕНЬКИ і за 130 pt від назви ЗУБИЛО з сусідньої
клітинки, і геометрична близькість обирає чужу. Тому ланцюг інший:

    артикул → своє ФОТО (найближче над ним із перетином по x)
    фото    → своя НАЗВА (під фото або праворуч від нього)

Фото — вкладена картинка, не рендер сторінки: у рендер лізуть значки
«хромованадієва сталь» і підписи. Повносторінкові підкладки (606×861 pt)
відсіюємо за площею.

Запуск (venv з pymupdf і pillow):
  .venv-pdf/bin/python scripts/syla-catalog/parse.py "~/Downloads/Каталог СИЛА 2026 весна-літо.pdf" output/syla-catalog/2026

Результат: index.json, photos/<артикул>.jpg, contact-sheet-N.png.
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

ARTICLE = re.compile(r"^\d{6}$")
HEADER_Y = 45          # pt: вище — колонтитул розділу
TITLE_SIZE = (7.5, 9)  # кегль назви товару
ART_SIZE = (5.5, 6.6)  # кегль артикулу
PROSE_SIZE = (6.7, 7.4)  # кегль опису-прози
TITLE_LINE_GAP = 13    # pt: розрив, у межах якого рядки назви — одна назва
PHOTO_LEFT = 60        # pt: фото ліворуч від рядка таблиці (сторінки-реєстри)
TITLE_COLUMN = 70      # pt: у межах цієї смуги назва вважається «в колонці»
PHOTO_TAIL = 8         # pt: наскільки рядок може звисати нижче свого знімка.
                       # Більший допуск ламає картки: на стор. 55 артикул
                       # паяльника опинявся «праворуч» від знімка клейового
                       # пістолета із сусідньої колонки й брав його назву.
TITLE_BELOW_GAP = 30   # pt: назва під фото стоїть не далі
TITLE_ASIDE_UP = 25    # pt: назва праворуч може починатись трохи вище фото
TITLE_ASIDE_RIGHT = 60 # pt: і не далі як на стільки праворуч від знімка
TITLE_BELOW_OVERLAP = 15  # pt: назва під фото може «заходити» на його поле
# Шапки стовпчиків набрані так само, як плашка розділу (білий Black-6).
COLUMN_HEADS = {
    "ЯЩИК", "УПАКОВКА", "ДОВЖИНА", "РУКОЯТКА", "КОЛІР", "ВАГА", "RAL",
    "РІЗЬБЛЕННЯ", "МАТЕРІАЛ", "ТИП", "РОЗМІР", "АРТИКУЛ", "КІЛЬКІСТЬ",
}
MIN_IMAGE_PX = 10000
MIN_IMAGE_PT = 20

doc = pymupdf.open(SRC)
PAGE_AREA = doc[0].rect.width * doc[0].rect.height


def in_range(value, bounds):
    return bounds[0] <= value <= bounds[1]


def spans_of(page):
    out = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                text = span["text"].replace("\t", " ").strip()
                if not text or span["bbox"][1] < HEADER_Y:
                    continue
                out.append(
                    {
                        "text": text,
                        "x": span["bbox"][0],
                        "y": span["bbox"][1],
                        "x1": span["bbox"][2],
                        "size": span["size"],
                        "font": span["font"],
                        "white": span["color"] == 16777215,
                    }
                )
    out.sort(key=lambda s: (round(s["y"], 1), s["x"]))
    return out


def photos_of(page):
    out = []
    for im in page.get_image_info(xrefs=True):
        x0, y0, x1, y1 = im["bbox"]
        if not im.get("xref") or im["width"] * im["height"] < MIN_IMAGE_PX:
            continue
        if (x1 - x0) * (y1 - y0) > 0.5 * PAGE_AREA:
            continue
        if x1 - x0 < MIN_IMAGE_PT or y1 - y0 < MIN_IMAGE_PT:
            continue
        out.append(im)
    out.sort(key=lambda m: (m["bbox"][1], m["bbox"][0]))
    return out


def titles_of(spans):
    """
    Назви товарів. Дві форми:
      - у картках — GothamPro-Black кегль 8, сусідні рядки склеєні в одну;
      - на сторінках-реєстрах — назва розділу білим по чорній плашці, і це
        той самий Black кегль 6, що й артикул. Відрізняємо за кольором і
        відкидаємо шапки стовпчиків: їх мало і вони повторюються сотнями.
    """
    heads = [
        s
        for s in spans
        if "Black" in s["font"]
        and not ARTICLE.match(s["text"])
        and (
            in_range(s["size"], TITLE_SIZE)
            or (in_range(s["size"], ART_SIZE) and s["white"] and s["text"].upper() not in COLUMN_HEADS)
        )
    ]
    heads.sort(key=lambda s: (round(s["x"], 0), s["y"]))
    merged = []
    for span in heads:
        if merged and abs(span["x"] - merged[-1]["x"]) < 4 and 0 < span["y"] - merged[-1]["last_y"] < TITLE_LINE_GAP:
            merged[-1]["text"] += " " + span["text"]
            merged[-1]["last_y"] = span["y"]
            merged[-1]["x1"] = max(merged[-1]["x1"], span["x1"])
        else:
            merged.append({**span, "last_y": span["y"]})
    return merged


def title_for(photo, titles):
    """Назва клітинки: під фото або праворуч від нього. Найближча."""
    px0, py0, px1, py1 = photo["bbox"]
    best = None
    for title in titles:
        # Назва ПІД фото. Допускаємо, що вона на кілька пунктів вища за
        # нижній край знімка: у знімків прозорі поля, і на стор. 102 назва
        # «ПАЛАТКА МІРАЖ» стоїть на 8 pt вище краю свого фото.
        below = (
            px0 - 20 <= title["x"] <= px1 + 20
            and -TITLE_BELOW_OVERLAP <= title["y"] - py1 <= TITLE_BELOW_GAP
        )
        # Назва ПРАВОРУЧ від фото (таблиця варіантів під знімком).
        aside = (
            px1 - 12 <= title["x"] <= px1 + TITLE_ASIDE_RIGHT
            and py0 - TITLE_ASIDE_UP <= title["y"] <= py1
        )
        if not (below or aside):
            continue
        # Назва під знімком — сильніший знак за назву збоку: інакше на
        # сторінках у чотири колонки кожен знімок брав назву СУСІДНЬОЇ
        # колонки, і всі намети з'їжджали на одну позицію.
        dist = abs(title["y"] - py1) if below else TITLE_BELOW_GAP + abs(title["x"] - px1)
        if best is None or dist < best[0]:
            best = (dist, title)
    return best[1] if best else None


def photo_for(article, photos, titles, own_title):
    """
    Фото артикулу. Спершу шукаємо ЛІВОРУЧ від рядка (сторінки-реєстри: знімок
    струбцини стоїть збоку і накриває кілька рядків таблиці) — там зв'язок
    однозначний. Якщо такого немає, беремо найближче НАД артикулом із
    перетином по горизонталі: так стоять картки й таблиці варіантів.
    """
    def aside_of(pad):
        return [
            im
            for im in photos
            if im["bbox"][1] - pad <= article["y"] <= im["bbox"][3] + PHOTO_TAIL
            and 0 <= article["x"] - im["bbox"][2] <= PHOTO_LEFT
        ]

    # Спершу строго: знімок починається не нижче за рядок. Межі груп тут
    # тонкі — сусідні рядки розділяє 0,3 pt, — тому допуск дозволяємо лише
    # тоді, коли строгий пошук не дав нічого (перший рядок таблиці, де
    # верхівка знімка на пів пункта нижча за верхівку тексту).
    aside = aside_of(0) or aside_of(8)
    if aside:
        # Знімок вирівняний по ВЕРХНЬОМУ рядку своєї групи, а смуги сусідніх
        # знімків наїжджають одна на одну через прозорі поля. Тому рядок
        # належить останньому знімку, що починається не нижче за нього, — ні
        # «смуга накриває», ні «найближчий центр» межі груп не вгадують
        # (перевірено на стор. 17: це правило дає 25 рядків із 25).
        return max(aside, key=lambda im: im["bbox"][1])
    # Інакше — найближче фото НАД артикулом із перетином по горизонталі.
    # Відстань не обмежуємо числом: на стор. 27 таблиця ріжкових ключів має
    # 27 рядків і тягнеться на 400 pt від свого знімка. Замість цього
    # зупиняємось на чужій назві: якщо між знімком і артикулом у тій самій
    # колонці почалась інша клітинка, знімок уже не наш.
    above = sorted(
        (im for im in photos if im["bbox"][0] - 15 <= article["x"] <= im["bbox"][2] + 15 and im["bbox"][3] <= article["y"]),
        key=lambda im: -im["bbox"][3],
    )
    for im in above:
        own = own_title(im)
        blocked = any(
            t is not own
            and im["bbox"][3] < t["y"] < article["y"]
            and abs(t["x"] - article["x"]) < TITLE_COLUMN
            for t in titles
        )
        if not blocked:
            return im
    return None


def extract_photo(xref, path):
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


cells, rows, seen, by_xref = {}, [], set(), {}
for pno in range(doc.page_count):
    page = doc[pno]
    spans = spans_of(page)
    photos = photos_of(page)
    titles = titles_of(spans)
    articles = [
        s for s in spans if "Black" in s["font"] and in_range(s["size"], ART_SIZE) and ARTICLE.match(s["text"])
    ]

    # Ключ клітинки мусить бути стабільним: id() об'єкта Python після
    # прибирання сміття перевикористовується, і клітинки з різних сторінок
    # злипались, а файли фото перетирали одне одного.
    def cell_key(im):
        return (pno, im["xref"], round(im["bbox"][0]), round(im["bbox"][1]))

    by_photo = {cell_key(im): title_for(im, titles) for im in photos}
    for art in articles:
        if art["text"] in seen:
            continue  # той самий артикул у зведеній таблиці далі — лишаємо перший
        photo = photo_for(art, photos, titles, lambda im: by_photo.get(cell_key(im)))
        title = by_photo.get(cell_key(photo)) if photo else None
        if title is None:
            # Сторінка-реєстр: назва — плашка розділу над таблицею, вона
            # діє до наступної плашки. Інакше — найближча назва над
            # артикулом у тій самій колонці.
            bars = [t for t in titles if t.get("white") and t["y"] < art["y"]]
            if bars:
                title = max(bars, key=lambda t: t["y"])
            else:
                above = [
                    t
                    for t in titles
                    if t["y"] < art["y"] and abs(t["x"] - art["x"]) < 60 and art["y"] - t["y"] < 90
                ]
                title = max(above, key=lambda t: t["y"]) if above else None

        # варіант («300 мм») і фасування — те, що стоїть праворуч від
        # артикулу на тому ж рядку або одразу під ним у формі А
        variant = " ".join(
            s["text"]
            for s in spans
            if s is not art and abs(s["y"] - art["y"]) < 4 and s["x"] > art["x1"]
        ).strip()
        if not variant:
            under = [
                s
                for s in spans
                if abs(s["x"] - art["x"]) < 6 and 0 < s["y"] - art["y"] < 16 and "Light" in s["font"]
            ]
            variant = under[0]["text"] if under else ""

        seen.add(art["text"])
        key = cell_key(photo) if photo else (pno, "t", title["text"] if title else "", round(art["x"]))
        gid = cells.get(key, {}).get("id") or art["text"]
        photo_file = None
        if photo:
            photo_file = by_xref.get(photo["xref"])
            if not photo_file:
                photo_file = f"{gid}.jpg"
                extract_photo(photo["xref"], f"{OUT}/photos/{photo_file}")
                by_xref[photo["xref"]] = photo_file
        cell = cells.setdefault(
            key,
            {
                "id": gid,
                "page": pno + 1,
                "title": title["text"] if title else "",
                "photo": photo_file,
                "px": [photo["width"], photo["height"]] if photo else None,
                "articles": [],
            },
        )
        cell["articles"].append(art["text"])
        rows.append(
            {
                "article": art["text"],
                "page": pno + 1,
                "group": cell["id"],
                "title": title["text"] if title else "",
                "variant": variant,
                "photo": photo_file,
            }
        )

groups = list(cells.values())
json.dump(
    {"catalogYear": "2026", "source": os.path.basename(SRC), "groups": groups, "rows": rows},
    open(f"{OUT}/index.json", "w"),
    ensure_ascii=False,
    indent=1,
)

print(f"клітинок: {len(groups)} | артикулів: {len(rows)} | фото-файлів: {len(by_xref)}")
print(f"артикулів з фото: {sum(1 for r in rows if r['photo'])} | без назви: {sum(1 for r in rows if not r['title'])}")

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
        text = f"стор.{g['page']}\n{g['title'][:70]}\n" + ", ".join(g["articles"][:8])
        draw.multiline_text((cx + 8, cy + 155), text[:230], fill="black", font=small, spacing=2)
    sheet.save(f"{OUT}/contact-sheet-{sheet_no + 1}.png")
print(f"контактних аркушів: {sheets}")
