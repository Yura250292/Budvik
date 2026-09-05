/**
 * Номерні піни, що злиплися на дрібному масштабі, — в один значок.
 *
 * Проблема суто екранна, і від даних не залежить. Пін має сталий розмір у
 * пікселях, а відстань між точками на екрані стискається разом із
 * масштабом: точки за пʼятсот метрів одна від одної на огляді всього дня
 * опиняються в тому самому квадратику. Водій, який відсунув карту, щоб
 * побачити день цілком, бачив кашу з номерів 4, 5 і 6, накладених один на
 * одного, — і саме тоді, коли карта потрібна найбільше.
 *
 * Тому групуємо не за географією, а за ПІКСЕЛЯМИ поточного масштабу.
 * Наблизив — групи розпадаються самі, бо та сама відстань у метрах стає
 * більшою на екрані.
 *
 * Дві точки навмисно ніколи не зливаються з сусідами:
 *
 *   поточна ціль — це єдина точка, яку водій мусить бачити завжди, і
 *   ховати її в групу означає ховати відповідь на питання «куди зараз»;
 *
 *   бонусна поїздка — у неї немає номера в обʼїзді (на піні стоїть «+»),
 *   і всередині діапазону «4–6» вона стала б невидимою.
 */

export type PinLike = {
  key: string;
  lat: number;
  lng: number;
  /** Номер в обʼїзді. Для бонусної поїздки не має сенсу. */
  seq: number;
  current?: boolean;
  errand?: boolean;
};

export type PinCluster<T> = {
  /** Точка, на якій стоїть значок: найменший номер у групі. */
  lead: T;
  /** Усі точки групи, за зростанням номера. Одна — звичайний пін. */
  items: T[];
  /** Напис на значку: «4», «4–6» або «4 +2». */
  label: string;
};

/** Скільки пікселів між центрами вже означає накладання значків. */
export const PIN_GAP_PX = 38;

/**
 * Напис групи.
 *
 * Поспіль (4, 5, 6) — діапазон: він читається з одного погляду й нічого не
 * приховує. Урозкид (4, 9, 15) діапазоном писати не можна — «4–15»
 * пообіцяло б дванадцять точок, яких там немає, — тому пишемо перший номер
 * і скільки ще.
 */
function labelFor<T extends PinLike>(items: T[]): string {
  if (items.length === 1) return items[0].errand ? "+" : String(items[0].seq);

  const seqs = items.map((s) => s.seq);
  const min = Math.min(...seqs);
  const max = Math.max(...seqs);
  const consecutive = max - min === items.length - 1;

  return consecutive ? `${min}–${max}` : `${min} +${items.length - 1}`;
}

/**
 * Зводить піни, що накладаються на цьому масштабі.
 *
 * `toPixel` дає екранні координати точки в поточному масштабі; карта
 * рахує їх сама (у Google — через проєкцію, у Leaflet — через `project`).
 * Абсолютна прив'язка не важлива: беремо лише відстані, а вони від
 * прокрутки не залежать.
 */
export function clusterPins<T extends PinLike>(
  pins: T[],
  toPixel: (p: { lat: number; lng: number }) => { x: number; y: number },
  minGapPx: number = PIN_GAP_PX
): PinCluster<T>[] {
  // За номером обʼїзду: так провідною в групі стає найрання точка, і
  // діапазони виходять природні («4–6», а не «6–4»).
  const ordered = [...pins].sort((a, b) => a.seq - b.seq);
  const at = new Map<string, { x: number; y: number }>();
  for (const p of ordered) at.set(p.key, toPixel(p));

  const used = new Set<string>();
  const out: PinCluster<T>[] = [];

  for (const lead of ordered) {
    if (used.has(lead.key)) continue;
    used.add(lead.key);

    const solo = !!lead.current || !!lead.errand;
    const items: T[] = [lead];

    if (!solo) {
      const a = at.get(lead.key)!;
      for (const other of ordered) {
        if (used.has(other.key) || other.current || other.errand) continue;
        const b = at.get(other.key)!;
        if (Math.hypot(a.x - b.x, a.y - b.y) >= minGapPx) continue;
        used.add(other.key);
        items.push(other);
      }
    }

    out.push({ lead, items, label: labelFor(items) });
  }

  return out;
}
