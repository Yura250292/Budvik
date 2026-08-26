/**
 * Історія пошуку — локально на пристрої.
 *
 * Люди шукають те саме по колу: «ліска 3мм», артикул із цінника, назву
 * бренда. Набирати це щоразу з нуля на телефоні дорого, а екран пошуку до
 * першого натиску був просто порожнім аркушем.
 *
 * Тільки на пристрої і нікуди не їде. Запити — це те, що людина шукала, і
 * відправляти їх на сервер заради зручності, про яку ніхто не просив, не
 * варто. Побічно це й простіше: історія працює без входу.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "budvik.searchHistory";

/** Скільки тримаємо. Далі список перестає бути «останнім» і стає архівом. */
const LIMIT = 8;

/** Читання не має валити екран: зіпсований запис — не привід не показати пошук. */
export async function getHistory(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Додає запит угору списку.
 *
 * Порівняння без регістру й пробілів по краях: «Дриль» і «дриль » — це той
 * самий запит, і два майже однакові рядки в короткому списку виглядають як
 * помилка.
 */
export async function pushHistory(query: string): Promise<string[]> {
  const q = query.trim();
  if (!q) return getHistory();

  const prev = await getHistory();
  const next = [q, ...prev.filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, LIMIT);
  await save(next);
  return next;
}

export async function removeFromHistory(query: string): Promise<string[]> {
  const next = (await getHistory()).filter((x) => x !== query);
  await save(next);
  return next;
}

export async function clearHistory(): Promise<void> {
  await save([]);
}

async function save(list: string[]) {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Пам'ять пристрою переповнена — історія не та річ, заради якої варто
       показувати людині помилку. */
  }
}
