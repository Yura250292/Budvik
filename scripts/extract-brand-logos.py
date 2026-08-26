"""
Витягує логотипи брендів із каталогів постачальників.

Каталог у PDF — єдине джерело логотипа, якому можна вірити: він приходить
від самого виробника, там логотип векторний і в правильних кольорах. Крайня
альтернатива — вирізати з фотографії коробки, але це перекошений растр із
відблиском, часто ще й із чужим водяним знаком.

Рендеримо сторінку в 300 DPI, вирізаємо ділянку логотипа, обрізаємо однорідні
поля. Растр, а не вектор — для плитки 80×40 на телефоні цього більш ніж
досить, а розбір векторних контурів PDF коштував би непорівнянно дорожче.
"""

import subprocess, sys, os
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else "logos"
os.makedirs(OUT, exist_ok=True)

DPI = 300

# Ділянки логотипів у частках сторінки: (зліва, зверху, справа, знизу).
# Підібрані за обкладинками; після вирізання поля обрізаються автоматично.
CATALOGS = [
    {
        "slug": "grosser",
        "name": "Grösser",
        "pdf": "/Users/admin/Downloads/Grösser 17.06.26.pdf",
        "page": 1,
        "box": (0.26, 0.002, 0.74, 0.052),
    },
    {
        "slug": "polax",
        "name": "POLAX",
        "pdf": "/Users/admin/Downloads/КАТАЛОГ_2026_ua_web+.pdf",
        "page": 1,
        "box": (0.015, 0.105, 0.40, 0.21),
    },
    {
        "slug": "total",
        "name": "TOTAL",
        "pdf": "/Users/admin/Downloads/Ukrainian Catalogue 20260227_8f920475-3302-49b2-8685-3c2ee4ec8c8b.pdf",
        "page": 1,
        "box": (0.02, 0.10, 0.52, 0.23),
    },
]


def render(pdf: str, page: int, dest: str) -> str:
    """Одна сторінка PDF у PNG. pdftoppm сам додає -001 до імені."""
    subprocess.run(
        ["pdftoppm", "-f", str(page), "-l", str(page), "-r", str(DPI), "-png", pdf, dest],
        check=True,
        capture_output=True,
    )
    # pdftoppm нумерує файли за кількістю сторінок у документі: у каталозі на
    # 1200 сторінок це буде -0001, а не -001. Тому шукаємо, а не вгадуємо.
    import glob
    hits = sorted(glob.glob(f"{dest}-*.png"))
    if not hits:
        raise FileNotFoundError(f"pdftoppm нічого не створив для {pdf}")
    return hits[0]


def trim(img: Image.Image) -> Image.Image:
    """
    Обрізає однорідні поля навколо логотипа.

    Колір поля беремо з лівого верхнього пікселя, а не вважаємо білим:
    у POLAX і TOTAL логотип світлий на темному, і «обрізати біле» лишило б
    усю плашку.
    """
    rgb = img.convert("RGB")
    bg = rgb.getpixel((0, 0))
    px = rgb.load()
    w, h = rgb.size

    def uniform_row(y):
        return all(sum(abs(a - b) for a, b in zip(px[x, y], bg)) < 30 for x in range(0, w, 3))

    def uniform_col(x):
        return all(sum(abs(a - b) for a, b in zip(px[x, y], bg)) < 30 for y in range(0, h, 3))

    top = 0
    while top < h - 1 and uniform_row(top):
        top += 1
    bottom = h - 1
    while bottom > top and uniform_row(bottom):
        bottom -= 1
    left = 0
    while left < w - 1 and uniform_col(left):
        left += 1
    right = w - 1
    while right > left and uniform_col(right):
        right -= 1

    pad = 12
    return img.crop(
        (max(0, left - pad), max(0, top - pad), min(w, right + pad), min(h, bottom + pad))
    )


for cat in CATALOGS:
    print(f"{cat['name']}…", end=" ", flush=True)
    try:
        page_png = render(cat["pdf"], cat["page"], f"{OUT}/_page_{cat['slug']}")
        img = Image.open(page_png)
        w, h = img.size
        l, t, r, b = cat["box"]
        crop = img.crop((int(w * l), int(h * t), int(w * r), int(h * b)))
        crop = trim(crop)

        # Стеля по ширині: для плитки 80×40 більше 800 px не потрібно нікому.
        if crop.width > 800:
            crop = crop.resize((800, int(crop.height * 800 / crop.width)), Image.LANCZOS)

        dest = f"{OUT}/{cat['slug']}.png"
        crop.save(dest)
        os.remove(page_png)
        print(f"{crop.width}×{crop.height} → {dest}")
    except Exception as e:
        print("НЕ ВИЙШЛО:", e)
