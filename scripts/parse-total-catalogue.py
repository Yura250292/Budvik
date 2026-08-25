#!/usr/bin/env python3
"""
Розбір офіційного PDF-каталогу TOTAL у машинний індекс.

Каталог зверстаний в Illustrator: на сторінці сітка 2×5 карток, у кожній —
назва (білим на бірюзовій смузі), артикул (білим на червоній), фото зліва,
характеристики справа й таблиця пакування знизу (одиниця / мала коробка /
велика коробка). Розбираємо не за регулярками по тексту, а за шрифтами й
координатами: артикул — EurostileLT-Demi 7.3 pt білий, назва — 6.7 pt білий,
характеристики — 4.8–4.9 pt темні. Так не залежимо від форми артикула
(бувають PBCA12001, TP630-2, THKISD34082L).

Фото беремо вбудоване (≈415 px, RGB на білому) — це те саме, що бачить
покупець у каталозі, і перерендерювати сторінку сенсу немає: деталей у
джерелі більше нема.

Потрібно: python3 -m venv venv && venv/bin/pip install pymupdf pillow
Запуск:  venv/bin/python scripts/parse-total-catalogue.py <каталог.pdf> <тека-виводу>
Результат: <тека>/index.json і <тека>/images/<АРТИКУЛ>.jpg
"""
import collections
import json
import os
import re
import sys

import pymupdf
from PIL import Image

SKU_FONT, SKU_SIZE = "EurostileLT-Demi", 7.3
TITLE_SIZE = 6.7
DESC_SIZES = (4.8, 4.9)
PACK_NUM_SIZE, UNIT_SIZE = 7.1, 5.9
WHITE = 0xFFFFFF
COLUMN_SPLIT = 300  # pt; ліва колонка карток x<300, права — далі
ROW_PITCH = 132     # висота картки, якщо нижче в колонці нічого нема
ICON = (171, 79)    # піктограма «Unit», повторюється в кожній картці


def cell_spans(page):
    out = []
    for b in page.get_text("dict")["blocks"]:
        if b["type"] != 0:
            continue
        for line in b["lines"]:
            for s in line["spans"]:
                if s["text"].strip():
                    out.append({"t": s["text"], "font": s["font"], "size": round(s["size"], 1),
                                "color": s["color"], "bbox": [round(x, 1) for x in s["bbox"]]})
    return out


def join_spans(spans):
    """Склеює спани одного рядка, ставлячи пробіл лише там, де є зазор."""
    txt, prev_x1 = "", None
    for k in sorted(spans, key=lambda k: k["bbox"][0]):
        gap = prev_x1 is not None and k["bbox"][0] - prev_x1 > 1.0
        if gap and not txt.endswith(" ") and not k["t"].startswith(" "):
            txt += " "
        txt += k["t"]
        prev_x1 = k["bbox"][2]
    txt = re.sub(r"\s+", " ", txt).strip()
    txt = re.sub(r"\s+([,.)])", r"\1", txt)
    return re.sub(r"\(\s+", "(", txt)


def group_lines(spans, tol=1.0):
    lines = collections.OrderedDict()
    for sp in sorted(spans, key=lambda k: (round(k["bbox"][1]), k["bbox"][0])):
        y = round(sp["bbox"][1])
        key = next((k for k in lines if abs(k - y) <= tol), y)
        lines.setdefault(key, []).append(sp)
    return [(min(s["bbox"][0] for s in sps), join_spans(sps)) for sps in lines.values()]


def merge_continuations(lines):
    """Рядок, зсунутий праворуч від базового відступу, — перенесення попереднього."""
    if not lines:
        return []
    base = min(x for x, _ in lines)
    out = []
    for x, t in lines:
        if not t or t == "Unit":
            continue
        if out and x > base + 1.5:
            sep = "" if out[-1].endswith(("/", "-")) else " "
            out[-1] = out[-1] + sep + t
        else:
            out.append(t)
    return out


def parse(pdf_path, out_dir):
    doc = pymupdf.open(pdf_path)
    img_dir = os.path.join(out_dir, "images")
    os.makedirs(img_dir, exist_ok=True)
    items, problems = [], []

    for pi, page in enumerate(doc):
        spans = cell_spans(page)
        skus = [s for s in spans if s["font"] == SKU_FONT and s["size"] == SKU_SIZE and s["color"] == WHITE]
        if not skus:
            continue
        images = [im for im in page.get_image_info(xrefs=True)
                  if im["width"] > 150 and (im["width"], im["height"]) != ICON]
        skus.sort(key=lambda s: (round(s["bbox"][1] / 10), s["bbox"][0]))

        for s in skus:
            sku = s["t"].strip()
            x0, y0 = s["bbox"][0], s["bbox"][1]
            left = x0 < COLUMN_SPLIT
            cx0, cx1 = (40, 305) if left else (300, 575)
            below = [k["bbox"][1] for k in skus if (k["bbox"][0] < COLUMN_SPLIT) == left and k["bbox"][1] > y0 + 5]
            cy0 = y0 - 14
            cy1 = min(below) - 14 if below else y0 + ROW_PITCH
            cell = [sp for sp in spans if cx0 <= sp["bbox"][0] < cx1 and cy0 <= sp["bbox"][1] < cy1]

            title_spans = [sp for sp in cell if sp["color"] == WHITE and sp["size"] == TITLE_SIZE]
            title = " ".join(t for _, t in group_lines(title_spans, tol=3))
            title = re.sub(r"\s+([,.)])", r"\1", title).strip()

            desc_spans = [sp for sp in cell if sp["color"] != WHITE and sp["size"] in DESC_SIZES and sp["bbox"][1] > y0]
            lines = merge_continuations(group_lines(desc_spans))

            pack = [sp["t"].strip() for sp in sorted((sp for sp in cell if sp["size"] == PACK_NUM_SIZE), key=lambda k: k["bbox"][0])]
            unit = next((sp["t"].strip() for sp in cell if sp["size"] == UNIT_SIZE), None)

            cand = []
            for im in images:
                bx = im["bbox"]
                mx, my = (bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2
                if cx0 <= mx < cx1 and cy0 <= my < cy1:
                    cand.append(im)
            cand.sort(key=lambda im: (im["bbox"][2] - im["bbox"][0]) * (im["bbox"][3] - im["bbox"][1]), reverse=True)

            image = None
            if cand:
                pix = pymupdf.Pixmap(doc, cand[0]["xref"])
                if pix.n - pix.alpha >= 4:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                im = Image.frombytes("RGBA" if pix.alpha else "RGB", (pix.width, pix.height), pix.samples)
                if im.mode == "RGBA":
                    bg = Image.new("RGB", im.size, (255, 255, 255))
                    bg.paste(im, mask=im.split()[3])
                    im = bg
                image = f"{sku}.jpg"
                im.save(os.path.join(img_dir, image), "JPEG", quality=92, optimize=True)
            else:
                problems.append((pi + 1, sku, "немає фото"))

            if len(pack) != 2 or not title or not lines:
                problems.append((pi + 1, sku, f"title={bool(title)} lines={len(lines)} pack={pack}"))

            items.append({
                "sku": sku, "page": pi + 1, "title": title, "lines": lines,
                "unit": unit, "packSmall": int(pack[0]) if len(pack) > 0 and pack[0].isdigit() else None,
                "packBig": int(pack[1]) if len(pack) > 1 and pack[1].isdigit() else None,
                "image": image,
            })

    dupes = [k for k, v in collections.Counter(i["sku"] for i in items).items() if v > 1]
    index = {"brand": "TOTAL", "source": os.path.basename(pdf_path), "pages": len(doc), "items": items}
    with open(os.path.join(out_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print(f"товарів: {len(items)}, дублів артикулів: {len(dupes)} {dupes[:10]}")
    print(f"проблем: {len(problems)}")
    for p in problems[:30]:
        print("  ", p)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("використання: parse-total-catalogue.py <каталог.pdf> <тека-виводу>")
    parse(sys.argv[1], sys.argv[2])
