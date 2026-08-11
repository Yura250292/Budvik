"use client";

import { SWRConfig } from "swr";

/**
 * Кеш даних для адмінки.
 *
 * Навіщо: вкладки в TabsViewport свідомо не тримаються змонтованими (причина
 * там у коментарі — `children` в App Router це слот, а не сталий елемент).
 * Тому кожне повернення на вкладку розмонтовувало сторінку, стан useState
 * зникав, і всі fetch стартували з нуля — на деяких розділах це кілька
 * мегабайтів на кожне перемикання.
 *
 * Кеш SWR живе в модульній мапі ПОЗА деревом React, тож переживає це
 * розмонтування: повернення на вкладку малює дані миттєво й тихо оновлює їх
 * у фоні. Стан компонентів це не рятує (і не може), але дані — так.
 *
 * revalidateOnFocus вимкнено свідомо: адміни постійно перемикаються між
 * вікнами, і кожне повернення фокусу інакше тягнуло б важкі відповіді знову.
 */
export default function AdminSwrProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher: async (url: string) => {
          const res = await fetch(url);
          if (!res.ok) {
            throw new Error(`Запит не вдався: ${res.status}`);
          }
          return res.json();
        },
        dedupingInterval: 30_000,
        revalidateOnFocus: false,
        keepPreviousData: true,
      }}
    >
      {children}
    </SWRConfig>
  );
}
