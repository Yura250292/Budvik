"""Контактні листи для перевірки фото товарів очима.

Складає з фотографій сітку з підписами (бренд, файл, скільки карток, перші
дві назви), щоб за один погляд було видно, де знімок не про той товар.
Дані готує scripts/photo-audit.mts --sheets.

Навіщо саме лист, а не перегляд карток поодинці: промах у групових фото
видно лише в порівнянні назви з картинкою, і 175 фото листами — це десяток
екранів замість сотень переходів.

Запуск:
    python3 scripts/photo-audit-sheets.py output/photo-audit/shared-photos-min3.json shared
    python3 scripts/photo-audit-sheets.py <json> <префікс> [--cols 6] [--per 24] [--out тека]

Фото тягне з R2 і кешує в <тека>/imgcache, тож повторний запуск миттєвий.
Нічого не змінює ні в базі, ні в сховищі.
"""
import json, os, sys, hashlib, urllib.request, textwrap
from PIL import Image, ImageDraw, ImageFont

FONT_R = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_B = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def fetch(url, cache):
    f = os.path.join(cache, hashlib.md5(url.encode()).hexdigest() + ".img")
    if not os.path.exists(f):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "budvik-photo-audit"})
            with open(f, "wb") as out:
                out.write(urllib.request.urlopen(req, timeout=30).read())
        except Exception as e:
            print(f"  ! не завантажилось: {url[-48:]} ({e})")
            return None
    try:
        return Image.open(f).convert("RGB")
    except Exception:
        return None


def sheets(items, out_dir, prefix, cols=6, per=24, cell=280, label_h=62):
    cache = os.path.join(out_dir, "imgcache")
    os.makedirs(cache, exist_ok=True)
    made = []
    for k in range(0, len(items), per):
        chunk = items[k:k + per]
        rows = (len(chunk) + cols - 1) // cols
        canvas = Image.new("RGB", (cols * cell, rows * (cell + label_h)), "white")
        d = ImageDraw.Draw(canvas)
        fb, fr = ImageFont.truetype(FONT_B, 15), ImageFont.truetype(FONT_R, 14)
        for i, it in enumerate(chunk):
            x0, y0 = (i % cols) * cell, (i // cols) * (cell + label_h)
            im = fetch(it["url"], cache)
            if im:
                im.thumbnail((cell - 20, cell - 20))
                canvas.paste(im, (x0 + (cell - im.width) // 2, y0 + label_h + (cell - 20 - im.height) // 2))
            else:
                d.text((x0 + 10, y0 + label_h + 40), "— фото не завантажилось —", font=fr, fill="red")
            d.text((x0 + 8, y0 + 6), it["lines"][0], font=fb, fill="black")
            yy = y0 + 26
            for ln in it["lines"][1:]:
                for w in textwrap.wrap(ln, 34)[:1]:
                    d.text((x0 + 8, yy), w, font=fr, fill="#333")
                yy += 17
            d.line([(x0, y0), (x0, y0 + cell + label_h)], fill="#DDD")
            d.line([(x0, y0), (x0 + cell, y0)], fill="#DDD")
        out = os.path.join(out_dir, f"{prefix}-{k // per}.jpg")
        canvas.save(out, quality=86)
        made.append(out)
        print(out, len(chunk))
    return made


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    src, prefix = sys.argv[1], sys.argv[2]
    opt = lambda name, dflt: int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else dflt
    out_dir = sys.argv[sys.argv.index("--out") + 1] if "--out" in sys.argv else os.path.dirname(src) or "."
    rows = json.load(open(src))
    items = []
    for i, r in enumerate(rows):
        names, skus = r.get("names") or [], r.get("skus") or []
        items.append({"url": r["image"], "lines": [
            f'#{i + 1}  ×{r.get("n", 1)}  {r.get("brand") or "—"}  [{os.path.basename(r["image"])}]',
            f'{skus[0]}: {names[0]}' if names else "",
            f'{skus[1]}: {names[1]}' if len(names) > 1 else "",
        ]})
    sheets(items, out_dir, prefix, cols=opt("--cols", 6), per=opt("--per", 24))


if __name__ == "__main__":
    main()
