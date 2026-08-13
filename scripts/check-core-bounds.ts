/**
 * Перевірка вікна карти по основному скупченню точок.
 *
 * Копія чистої логіки з SalesClientsMap.coreBounds: сам компонент тягне
 * leaflet, який без DOM не заводиться, а перевіряти треба саме арифметику
 * відсікання — через неї карта водія відкривалась на пів Європи.
 */

function core(points: Array<{ lat: number; lng: number }>) {
  if (points.length < 12) return null;
  const cut = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * 0.05);
    return [sorted[k], sorted[sorted.length - 1 - k]] as const;
  };
  const [latMin, latMax] = cut(points.map((p) => p.lat));
  const [lngMin, lngMax] = cut(points.map((p) => p.lng));
  return { latMin, latMax, lngMin, lngMax };
}

let failed = 0;
const check = (name: string, cond: boolean) => {
  if (!cond) { failed++; console.log(`  ✗ ${name}`); } else console.log(`  ✓ ${name}`);
};

// 1. Мало точок — не чіпаємо, хай працює звичайний fitBounds
check("менше 12 точок → null", core([{ lat: 49, lng: 24 }, { lat: 50, lng: 25 }]) === null);
check("рівно 11 точок → null",
  core(Array.from({ length: 11 }, (_, i) => ({ lat: 49 + i * 0.01, lng: 24 }))) === null);

// 2. Головний сценарій: Львівщина + поодинока точка на Донеччині
const lviv = Array.from({ length: 40 }, (_, i) => ({ lat: 49.8 + (i % 8) * 0.02, lng: 24.0 + (i % 5) * 0.02 }));
const withOutlier = [...lviv, { lat: 48.0, lng: 37.8 }];
const c = core(withOutlier)!;
check("викид на Донеччині не тягне вікно", c.lngMax < 25);
check("Львів лишається всередині вікна", c.latMin <= 49.8 && c.latMax >= 49.9);

// 3. Без викидів вікно покриває майже все
const dense = core(lviv)!;
check("щільна група: вікно охоплює основну масу", dense.lngMax >= 24.0 && dense.latMax >= 49.8);

// 4. Симетрія: викиди з обох країв
const both = [...lviv, { lat: 44.0, lng: 22.0 }, { lat: 52.0, lng: 40.0 }];
const bc = core(both)!;
check("викиди з обох країв відрізані", bc.latMin > 44.0 && bc.latMax < 52.0);

// 5. Порядок меж не перевертається
check("latMin <= latMax", bc.latMin <= bc.latMax);
check("lngMin <= lngMax", bc.lngMin <= bc.lngMax);

console.log(failed === 0 ? "\nУсі перевірки пройдено" : `\n${failed} перевірок впало`);
process.exit(failed === 0 ? 0 : 1);
