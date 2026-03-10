#!/usr/bin/env python3
"""
Конвертер файлів 1С (.dt) → CSV
Автоматично розпаковує .dt файл та витягує:
- Товари (Номенклатура)
- Контрагенти (ТОВ, ПП, ФОП)
- Текстові записи документів

Використання:
    python3 scripts/convert-1c-dt.py "шлях/до/файлу.dt" [output_dir]

Приклад:
    python3 scripts/convert-1c-dt.py "1C files/09.03.20261Cv8.dt" output/
"""

import zlib
import csv
import sys
import os
import re
import tempfile
from pathlib import Path


def decompress_dt(dt_path: str, output_path: str) -> int:
    """Розпаковує .dt файл (deflate з offset 9)"""
    print(f"Розпакування {dt_path}...")

    with open(dt_path, 'rb') as f:
        # Перевірка заголовку
        header = f.read(8)
        if header != b'1CIBDmpF':
            raise ValueError(f"Невірний формат файлу. Очікується '1CIBDmpF', отримано: {header}")

        f.seek(9)  # Дані починаються з offset 9
        d = zlib.decompressobj(-15)  # raw deflate

        total = 0
        with open(output_path, 'wb') as out:
            while True:
                chunk = f.read(1024 * 1024)  # 1MB chunks
                if not chunk:
                    break
                try:
                    result = d.decompress(chunk)
                    out.write(result)
                    total += len(result)

                    # Прогрес
                    if total % (100 * 1024 * 1024) < 1024 * 1024:
                        print(f"  {total / 1024 / 1024:.0f} MB розпаковано...")
                except zlib.error:
                    try:
                        result = d.flush()
                        out.write(result)
                        total += len(result)
                    except:
                        pass
                    break

    print(f"  Готово: {total / 1024 / 1024:.1f} MB")
    return total


def extract_strings(raw_path: str, min_length: int = 5):
    """Витягує всі UTF-16LE рядки з маркером 82 97"""
    print(f"Витягування даних...")

    all_strings = {}  # text -> offset

    chunk_size = 50 * 1024 * 1024  # 50MB chunks

    with open(raw_path, 'rb') as f:
        file_size = f.seek(0, 2)
        f.seek(0)

        offset = 0
        while offset < file_size:
            f.seek(offset)
            chunk = f.read(chunk_size)
            if not chunk:
                break

            idx = 0
            while True:
                idx = chunk.find(b'\x82\x97', idx)
                if idx == -1:
                    break

                if idx + 3 < len(chunk):
                    length = chunk[idx + 2]
                    if min_length <= length < 250:
                        text_raw = chunk[idx + 3:idx + 3 + length * 2]
                        try:
                            text = text_raw.decode('utf-16-le', errors='strict').strip()
                            has_cyrillic = any(0x0400 <= ord(c) <= 0x04FF for c in text)
                            has_printable = all(c.isprintable() or c in ' \t\n' for c in text)

                            if has_cyrillic and has_printable and len(text) >= min_length:
                                if text not in all_strings:
                                    all_strings[text] = offset + idx
                        except (UnicodeDecodeError, ValueError):
                            pass
                idx += 2

            offset += chunk_size

            # Прогрес
            progress = offset / file_size * 100
            if int(progress) % 10 == 0:
                print(f"  {progress:.0f}% ({len(all_strings)} рядків знайдено)")

    print(f"  Всього: {len(all_strings)} унікальних рядків")
    return all_strings


def categorize(strings: dict):
    """Розподіляє рядки на категорії: товари, контрагенти, інше"""

    products = []
    counterparties = []
    documents = []
    other = []

    # Метадані 1С - пропускаємо
    skip_patterns = [
        'Отбор', 'Фильтр', 'Настройк', 'Параметр', 'Автоматич',
        'Использ', 'Выгруж', 'Загруж', 'Запретит', 'Обработк',
        'АктивныеОбработки', 'ПоследнийОтклик'
    ]

    # Бренди та категорії товарів
    product_starts = [
        'SIGMA', 'APRO', 'DNIPRO', 'Soma Fix', 'SOMA', 'EDON', 'GRANITE',
        'Grad', 'Ultra', 'БРИГАДИР', 'Foresta', 'DWT', 'STIHL', 'ШТІЛЬ',
        'Бокорізи', 'Валік', 'Держак', 'Диск', 'Драбина', 'Ключ', 'Круг',
        'Леска', 'Молоток', 'Набір', 'Ніж', 'Патрон', 'Плоскогуб', 'Рівень',
        'Рукавиці', 'Свердло', 'Стусло', 'Шпатель', 'Щітка', 'Шліфувальн',
        'Правило', 'Паяльн', 'Фарборозпилювач', 'Хвостовик', 'Цвяхи',
        'Степлер', 'Тример', 'Генератор', 'Компресор', 'Перфоратор',
    ]

    product_keywords = [
        'мм ', 'мм,', 'мм)', ' мл', ' кг', 'Р40', 'Р60', 'Р80', 'Р100',
        ' d ', 'HRC', 'SDS', 'CrV', 'M14', '125мм', '150мм', '180мм',
    ]

    counterparty_patterns = [
        r'^ТОВ\s', r'^ПП\s', r'^ФОП\s', r'^ПрАТ',
        r'^ТОВАРИСТВО', r'^ПРИВАТНЕ\s+ПІДПРИЄМСТВО',
    ]

    for text, pos in strings.items():
        # Пропускаємо метадані
        if any(kw in text for kw in skip_patterns):
            continue

        if len(text) < 5:
            continue

        # Контрагенти
        is_counterparty = any(re.match(pat, text) for pat in counterparty_patterns)
        if is_counterparty and len(text) > 10:
            # Фільтруємо записи що починаються з ТОВАР (це коментарі)
            if not text.startswith('ТОВАР '):
                counterparties.append(text)
            continue

        # Товари
        is_product = any(text.startswith(kw) for kw in product_starts)
        if not is_product:
            is_product = any(kw in text for kw in product_keywords)

        if is_product and len(text) > 10:
            products.append(text)
        else:
            other.append(text)

    return {
        'products': sorted(set(products)),
        'counterparties': sorted(set(counterparties)),
        'other': sorted(set(other)),
    }


def save_csv(data: list, filepath: str, header: str = 'name'):
    """Зберігає список у CSV"""
    os.makedirs(os.path.dirname(filepath) or '.', exist_ok=True)
    with open(filepath, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow([header])
        for item in data:
            writer.writerow([item])
    print(f"  {filepath}: {len(data)} записів")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    dt_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) > 2 else 'output'

    if not os.path.exists(dt_path):
        print(f"Файл не знайдено: {dt_path}")
        sys.exit(1)

    print(f"=" * 60)
    print(f"Конвертер 1С .dt → CSV")
    print(f"Файл: {dt_path}")
    print(f"Розмір: {os.path.getsize(dt_path) / 1024 / 1024:.0f} MB")
    print(f"=" * 60)

    # Крок 1: Розпакування
    raw_path = os.path.join(output_dir, 'unpacked.raw')
    os.makedirs(output_dir, exist_ok=True)

    if os.path.exists(raw_path):
        print(f"\nВикористовуємо існуючий розпакований файл: {raw_path}")
    else:
        decompress_dt(dt_path, raw_path)

    # Крок 2: Витягування рядків
    strings = extract_strings(raw_path, min_length=5)

    # Крок 3: Категоризація
    print("\nКатегоризація даних...")
    categories = categorize(strings)

    # Крок 4: Збереження
    print("\nЗбереження результатів:")
    save_csv(categories['products'], os.path.join(output_dir, 'products.csv'), 'product_name')
    save_csv(categories['counterparties'], os.path.join(output_dir, 'counterparties.csv'), 'counterparty_name')
    save_csv(categories['other'][:5000], os.path.join(output_dir, 'other_records.csv'), 'text')

    # Крок 5: Видалення тимчасового файлу
    if os.path.exists(raw_path):
        size_gb = os.path.getsize(raw_path) / 1024 / 1024 / 1024
        print(f"\nТимчасовий файл: {raw_path} ({size_gb:.1f} GB)")
        print("Видалити? (введіть 'y' для видалення)")
        try:
            answer = input().strip().lower()
            if answer == 'y':
                os.remove(raw_path)
                print("Видалено.")
        except:
            pass

    # Підсумок
    print(f"\n{'=' * 60}")
    print(f"РЕЗУЛЬТАТ:")
    print(f"  Товарів:       {len(categories['products'])}")
    print(f"  Контрагентів:  {len(categories['counterparties'])}")
    print(f"  Інших записів: {len(categories['other'])}")
    print(f"  Файли збережено в: {output_dir}/")
    print(f"{'=' * 60}")


if __name__ == '__main__':
    main()
