"""
Розбір офіційного PDF-каталогу Polax у маніфест + фото по артикулах.

Каталог зверстаний в InDesign: кожен товар — біла рамка-картка з фото,
заголовком, блоком «ОСОБЛИВОСТІ/ПРИЗНАЧЕННЯ/…» і таблицею «Артикул … EAN».
Текст із PDF витягується разом із координатами, тож картки збираємо
геометрично: рядок таблиці → найменша біла рамка, що його містить →
фото та заголовок у тій самій рамці (і в тому ж вертикальному сегменті,
бо в одній рамці буває кілька таблиць одна під одною).

Чому не «просто картинки з PDF»: у веб-версії фото лежать поруч із
піктограмами, тінями і дублями шарів; без прив'язки до таблиці не
зрозуміло, який артикул на якому фото.

Запуск (одноразово, Python 3.10+):
  python3 -m venv .venv && .venv/bin/pip install pymupdf pillow
  .venv/bin/python scripts/polax-catalog/parse_catalog.py "<каталог.pdf>" <out-dir>

На виході в <out-dir>: manifest.json, images/<артикул>.jpg, images/k/<ключ>.jpg
(усі унікальні картинки, зокрема додаткові), sheet.jpg — контрольний лист
для перевірки оком. Далі — scripts/polax-catalog-sync.mts --upload <out-dir>.
"""
import io
import json
import os
import re
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

import pymupdf
from PIL import Image, ImageDraw, ImageFont

ART = re.compile(r"^\d{1,4}-\d{3}[A-Za-zА-Яа-я]?$")
KEYLINE = re.compile(r"^([А-ЯІЇЄҐ][А-ЯІЇЄҐ\s\-,/’']{2,40}):\s*(.*)$")


def ean_ok(s):
    if len(s) != 13 or not s.isdigit():
        return False
    d = [int(c) for c in s]
    return (10 - (sum(d[i] * (1 if i % 2 == 0 else 3) for i in range(12)) % 10)) % 10 == d[12]


def center(b):
    return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)


def contains(r, pt):
    return r[0] <= pt[0] <= r[2] and r[1] <= pt[1] <= r[3]


def area(r):
    return max(0, r[2] - r[0]) * max(0, r[3] - r[1])


def inter(a, b):
    return (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))


def smallest_frame(frames, pt):
    c = [f for f in frames if contains(f, pt)]
    return min(c, key=area) if c else None


def img_key(page, im):
    # Картинки всередині форм не мають xref — ключем стає сторінка + видимий прямокутник.
    return str(im["xref"]) if im["xref"] > 0 else f"p{page}_{'_'.join(str(v) for v in im['vis'])}"


def parse(doc):
    cards, pages_no_frames = [], []
    for pno in range(len(doc)):
        page = doc[pno]
        frames = []
        for d in page.get_drawings():
            r = d["rect"]
            if r.width < 100 or r.height < 80 or d.get("fill") != (1.0, 1.0, 1.0):
                continue
            key = (round(r.x0), round(r.y0), round(r.x1), round(r.y1))
            if key not in frames:
                frames.append(key)
        text = page.get_text("dict")["blocks"]
        # Лише рамки, у яких є таблиця з артикулами: білі вставки під фото — не картки.
        hdr_pts = [center(l["bbox"]) for b in text if b["type"] == 0 for l in b["lines"]
                   if "".join(sp["text"] for sp in l["spans"]).strip().lower() == "артикул"]
        frames = [f for f in frames if any(contains(f, pt) for pt in hdr_pts)]
        if not frames:
            pages_no_frames.append(pno + 1)
            continue
        lines = []
        for b in text:
            if b["type"] != 0:
                continue
            for l in b["lines"]:
                txt = "".join(s["text"] for s in l["spans"]).strip()
                if not txt:
                    continue
                sp = l["spans"][0]
                lines.append({"t": txt, "bb": l["bbox"], "size": sp["size"],
                              "bold": "bold" in sp["font"].lower(),
                              "fr": smallest_frame(frames, center(l["bbox"]))})
        imgs = []
        for info in page.get_image_info(xrefs=True):
            if info["width"] < 60 or info["height"] < 60:
                continue
            bb = [round(v) for v in info["bbox"]]
            fr = smallest_frame(frames, center(bb))
            if fr is None:
                # Фото, що вилазить за картку (обрізане кліпом): центр поза рамкою.
                best = max(frames, key=lambda f: area(inter(f, bb)))
                if area(inter(best, bb)) / max(1, area(bb)) >= 0.3:
                    fr = best
            imgs.append({"xref": info["xref"], "w": info["width"], "h": info["height"], "bb": bb, "fr": fr})
        for fr in frames:
            fl = sorted([l for l in lines if l["fr"] == fr], key=lambda l: (l["bb"][1], l["bb"][0]))
            fim = [i for i in imgs if i["fr"] == fr]
            if not fl and not fim:
                continue
            hdrs = [l for l in fl if l["t"].strip().lower() == "артикул"]
            if len(hdrs) <= 1:
                segs = [(fr[1], fr[3], hdrs[0] if hdrs else None)]
            else:
                # Кілька таблиць у рамці: ріжемо одразу під останнім рядком кожної.
                segs, prev_top = [], fr[1]
                for i, h in enumerate(hdrs):
                    nxt = hdrs[i + 1]["bb"][1] if i + 1 < len(hdrs) else fr[3]
                    rows_y = [l["bb"][3] for l in fl if ART.match(l["t"]) and h["bb"][1] < l["bb"][1] < nxt]
                    bottom = max(rows_y, default=h["bb"][3]) + 2 if i + 1 < len(hdrs) else fr[3]
                    segs.append((prev_top, bottom, h))
                    prev_top = bottom
            for (top, bottom, hdr) in segs:
                sl = [l for l in fl if top <= center(l["bb"])[1] <= bottom]
                heads = [l for l in sl if l["bold"] and l["size"] >= 8.5 and re.search(r"[А-ЯІЇЄҐA-Z]{2}", l["t"])]
                heading = re.sub(r"\s*\bnew\b\s*", " ", " ".join(l["t"] for l in heads), flags=re.I)
                heading = re.sub(r"\s+", " ", heading).strip()
                cols = []
                if hdr:
                    hy = center(hdr["bb"])[1]
                    first_row_top = min([l["bb"][1] for l in sl if ART.match(l["t"]) and l["bb"][1] > hdr["bb"][1]], default=hy + 8)
                    core = sorted([l for l in sl if abs(center(l["bb"])[1] - hy) < 5], key=lambda l: l["bb"][0])
                    cols = [{"t": l["t"], "x0": l["bb"][0], "x1": l["bb"][2], "ean": l["t"].upper().startswith("EAN")} for l in core]
                    # Перенесені на другий рядок частини заголовків колонок («Довжина,» / «мм»).
                    for l in sl:
                        cy = center(l["bb"])[1]
                        if abs(cy - hy) < 5 or not (hy - 12 < cy < first_row_top - 1) or (l["bold"] and l["size"] >= 8.5):
                            continue
                        for c in cols:
                            if l["bb"][0] < c["x1"] - 2 and l["bb"][2] > c["x0"] + 2:
                                c["t"] = (l["t"] + " " + c["t"]) if cy < hy else (c["t"] + " " + l["t"])
                                break
                    for c in cols:
                        c["t"] = re.sub(r"\s+", " ", c["t"]).strip()
                ean_x = next((c["x0"] - 15 for c in cols if c.get("ean")), None)
                ftop = max([l["bb"][3] for l in heads], default=top)
                fbot = hdr["bb"][1] if hdr else bottom
                features, cur = {}, None
                for l in sl:
                    if not (ftop - 1 <= l["bb"][1] and l["bb"][3] <= fbot + 1) or (l["bold"] and l["size"] >= 8.5):
                        continue
                    m = KEYLINE.match(l["t"])
                    if m:
                        cur = m.group(1).strip()
                        features[cur] = m.group(2).strip()
                    elif cur and l["size"] < 8 and l["bb"][0] < fr[0] + 60:
                        features[cur] = (features[cur] + " " + l["t"]).strip()
                rows = []
                for a in [l for l in sl if ART.match(l["t"]) and hdr and l["bb"][1] > hdr["bb"][1]]:
                    ay = center(a["bb"])[1]
                    cells = sorted([l for l in sl if abs(center(l["bb"])[1] - ay) < 4 and l is not a and l["bb"][0] > a["bb"][2] - 2],
                                   key=lambda l: l["bb"][0])
                    params, digits = {}, ""
                    for c in cells:
                        cx = center(c["bb"])[0]
                        if ean_x is not None and cx >= ean_x:
                            digits += re.sub(r"\D", "", c["t"])
                            continue
                        best = min(cols, key=lambda col: abs((col["x0"] + col["x1"]) / 2 - cx), default=None)
                        if best and best["t"].lower() != "артикул" and abs((best["x0"] + best["x1"]) / 2 - cx) < 60:
                            params[best["t"]] = (params.get(best["t"], "") + " " + c["t"]).strip()
                    # Під штрихкодом цифри інколи розсипані шрифтом штрихкоду — шукаємо валідне 13-значне вікно.
                    wins = [digits[i:i + 13] for i in range(max(0, len(digits) - 12)) if ean_ok(digits[i:i + 13])]
                    ean = digits if ean_ok(digits) else next((w for w in wins if w.startswith("482")), wins[0] if wins else None)
                    rows.append({"article": a["t"], "params": params, "ean": ean})
                sim = []
                for im in fim:
                    visf = inter(fr, im["bb"])
                    if area(visf) <= 0:
                        continue
                    best = max(segs, key=lambda sg: area(inter((fr[0], sg[0], fr[2], sg[1]), visf)))
                    if best[0] != top:
                        continue
                    ix = inter((fr[0], top, fr[2], bottom), visf)
                    sim.append({"xref": im["xref"], "w": im["w"], "h": im["h"], "bb": im["bb"],
                                "vis": [round(v) for v in ix], "area": area(ix)})
                sim.sort(key=lambda i: -i["area"])
                keep = []  # дублі шарів (тінь поверх фото) — геть, решта лишається як додаткові фото
                for im in sim:
                    if not any(area(inter(k["vis"], im["vis"])) / max(1, min(area(k["vis"]), area(im["vis"]))) > 0.6 for k in keep):
                        keep.append(im)
                for im in keep:
                    im["key"] = img_key(pno + 1, im)
                prev = cards[-1] if cards and cards[-1]["page"] == pno + 1 and cards[-1]["frame"] == fr else None
                if prev and rows and not heading:
                    # Підтаблиця без свого заголовка (змінні полотна тощо) — належить картці вище.
                    heading = prev["heading"]
                    if not keep:
                        keep = prev["images"]
                cards.append({"page": pno + 1, "frame": fr, "heading": heading, "features": features,
                              "columns": [c["t"] for c in cols], "rows": rows, "images": keep})
    return cards, pages_no_frames


def render_image(doc, xref):
    pix = pymupdf.Pixmap(doc, xref)
    if pix.n - pix.alpha >= 4:
        pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
    img = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGBA")
    smask = doc.xref_get_key(xref, "SMask")
    if smask[0] == "xref":
        m = Image.open(io.BytesIO(pymupdf.Pixmap(doc, int(smask[1].split()[0])).tobytes("png"))).convert("L")
        if m.size == img.size:
            img.putalpha(m)
    bg = Image.new("RGB", img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    return bg


def main(pdf_path, out):
    doc = pymupdf.open(pdf_path)
    cards, pages_no_frames = parse(doc)
    os.makedirs(f"{out}/images/k", exist_ok=True)
    uniq = {}
    for c in cards:
        if c["rows"]:
            for im in c["images"]:
                uniq.setdefault(im["key"], (c["page"], im))
    clipped = 0
    for k, (pno, im) in uniq.items():
        path = f"{out}/images/k/{k}.jpg"
        if os.path.exists(path):
            continue
        pil = None
        if im["xref"] > 0:
            try:
                pil = render_image(doc, im["xref"])
            except Exception:
                pil = None
        if pil is None:
            pix = doc[pno - 1].get_pixmap(clip=pymupdf.Rect(*im["vis"]), dpi=220)
            pil = Image.open(io.BytesIO(pix.tobytes("png"))).convert("RGB")
            clipped += 1
        pil.save(path, "JPEG", quality=88)
    items, seen = [], {}
    for c in cards:
        for r in c["rows"]:
            if r["article"] in seen:
                seen[r["article"]]["alsoOnPages"].append(c["page"])
                continue
            primary = c["images"][0]["key"] if c["images"] else None
            item = {
                "article": r["article"], "ean": r["ean"], "heading": c["heading"], "page": c["page"],
                "features": c["features"], "params": {k: v for k, v in r["params"].items() if k != "Пакувальні дані"},
                "packaging": r["params"].get("Пакувальні дані"),
                "image": f"images/{r['article']}.jpg" if primary else None, "imageKey": primary,
                "extraImages": [f"images/k/{im['key']}.jpg" for im in c["images"][1:]],
                "alsoOnPages": [],
            }
            if primary:
                shutil.copyfile(f"{out}/images/k/{primary}.jpg", f"{out}/images/{r['article']}.jpg")
            seen[r["article"]] = item
            items.append(item)
    manifest = {
        "brand": "POLAX", "catalog": "Каталог 2026", "source": os.path.basename(pdf_path), "pages": len(doc),
        "builtAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "stats": {"cards": sum(1 for c in cards if c["rows"]), "articles": len(items),
                  "withImage": sum(1 for i in items if i["image"]), "withEan": sum(1 for i in items if i["ean"]),
                  "pagesWithoutCards": pages_no_frames},
        "items": items,
    }
    json.dump(manifest, open(f"{out}/manifest.json", "w"), ensure_ascii=False, indent=1)
    # Контрольний лист: кожна ~10-та картка з фото, заголовком і артикулами.
    with_rows = [c for c in cards if c["rows"]]
    sample = with_rows[::max(1, len(with_rows) // 60)][:60]
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 11)
    except Exception:
        font = ImageFont.load_default()
    W, H, cols = 200, 250, 6
    sheet = Image.new("RGB", (W * cols, H * ((len(sample) + cols - 1) // cols)), "white")
    dr = ImageDraw.Draw(sheet)
    for i, c in enumerate(sample):
        x, y = (i % cols) * W, (i // cols) * H
        if c["images"]:
            im = Image.open(f"{out}/images/k/{c['images'][0]['key']}.jpg")
            im.thumbnail((W - 10, 150))
            sheet.paste(im, (x + 5, y + 5))
        dr.text((x + 5, y + 160), f"p{c['page']} {c['heading'][:28]}", fill="black", font=font)
        dr.text((x + 5, y + 175), c["heading"][28:56], fill="black", font=font)
        dr.text((x + 5, y + 195), " ".join(r["article"] for r in c["rows"][:4]), fill="blue", font=font)
    sheet.save(f"{out}/sheet.jpg", quality=80)
    print(json.dumps(manifest["stats"], ensure_ascii=False), "| unique images:", len(uniq), "| clip-rendered:", clipped)
    dup = [a for a, i in seen.items() if i["alsoOnPages"]]
    print("articles listed more than once:", len(dup), dup[:10])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
