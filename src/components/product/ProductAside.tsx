import type { Spec } from "@/lib/catalog/description-sections";

/**
 * Факти товару під фото: характеристики й комплектація.
 *
 * Живуть у плаваючій лівій колонці, тому опис обтікає їх праворуч. Сенс не
 * косметичний: у товарів із довгим описом ліворуч під фото лишалося пів
 * екрана порожнечі, а факти при цьому тонули в суцільній прозі. Тепер
 * факти зліва, проза справа.
 *
 * Умови покупки (ProductTerms) навмисно НЕ тут, а в правій колонці під
 * кнопкою: там вони і корисніші (питання «як заберу і чим заплачу»
 * виникає біля кнопки), і колонки виходять приблизно однакової висоти —
 * інакше ліва переростала текст і порожнеча просто міняла бік.
 */

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-g200 bg-white p-4 shadow-[var(--shadow-card)]">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-g500">{title}</h2>
      {children}
    </div>
  );
}

function SpecsCard({ specs }: { specs: Spec[] }) {
  return (
    <Card title="Характеристики">
      <dl className="divide-y divide-g100 text-sm">
        {specs.map((s, i) => (
          <div key={i} className="flex gap-3 py-2 first:pt-0 last:pb-0">
            {s.key ? (
              <>
                <dt className="w-2/5 flex-shrink-0 text-g400">{s.key}</dt>
                <dd className="min-w-0 flex-1 font-medium text-bk">{s.value}</dd>
              </>
            ) : (
              <dd className="text-g600">{s.value}</dd>
            )}
          </div>
        ))}
      </dl>
    </Card>
  );
}

function KitCard({ kit }: { kit: string[] }) {
  return (
    <Card title="Комплектація">
      <ul className="space-y-1.5 text-sm text-g600">
        {kit.map((line, i) => (
          <li key={i} className="flex gap-2">
            <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span className="min-w-0">{line}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Умови — рівно ті, що на оформленні замовлення, без обіцянок понад них. */
const TERMS = [
  {
    title: "Доставка",
    text: "Привеземо за вашою адресою",
    path: "M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1",
  },
  {
    title: "Самовивіз",
    text: "Заберете зі складу — адресу підкажемо в дзвінку",
    path: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  },
  {
    title: "Оплата при отриманні",
    text: "Готівкою або карткою. Передоплата не потрібна",
    path: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  },
];

export function ProductTerms() {
  return (
    <Card title="Купівля">
      <ul className="space-y-3">
        {TERMS.map((t) => (
          <li key={t.title} className="flex gap-3">
            <svg
              className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary-dark"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.6}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={t.path} />
            </svg>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-bk">{t.title}</span>
              <span className="block text-xs text-g400">{t.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ProductAside({ specs, kit }: { specs: Spec[]; kit: string[] }) {
  return (
    <div className="mt-4 space-y-3 md:mt-6">
      {specs.length > 0 && <SpecsCard specs={specs} />}
      {kit.length > 0 && <KitCard kit={kit} />}
    </div>
  );
}
