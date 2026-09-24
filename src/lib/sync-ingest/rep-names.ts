/**
 * Торговий з 1С («Ответственный» документа) → користувач сайту.
 *
 * У 1С записані повні імена («Пац Валентин», «Калашник Дар`я Олександрівна»),
 * на сайті — як завели («Валентин Пац»). Тому зіставляємо за словами: людина
 * сайту — та, чиї ВСІ слова імені є в імені з 1С, і така одна. Неоднозначність
 * — привід не вгадувати: приписати чужі продажі гірше, ніж не приписати нікому.
 *
 * Апострофи всіх видів (' ` ’ ʼ) — одне й те саме: 24.09.2026 1С перейменувала
 * «Калашник Дарья» на «Калашник Дар`я Олександрівна» зі зворотним апострофом,
 * і обмін 756 разів писав «торгового не знайдено».
 *
 * Модуль без next/* і без бази — його збирає воркер.
 */

/** Слова імені, нормалізовані; порядок, зайві пробіли й вид апострофа не мають значення. */
export function repNameWords(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/[`’ʼ‘]/g, "'")
      .split(/[\s.]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 3)
  );
}

/** id єдиного користувача, чиї слова імені всі є в імені з 1С; інакше null. */
export function matchRepByName(oneCName: string, users: { id: string; name: string | null }[]): string | null {
  const target = repNameWords(oneCName);
  if (target.size === 0) return null;
  const candidates = users.filter((u) => {
    if (!u.name?.trim()) return false;
    const words = repNameWords(u.name);
    return words.size > 0 && [...words].every((w) => target.has(w));
  });
  return candidates.length === 1 ? candidates[0].id : null;
}
