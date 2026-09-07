"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WidgetBody } from "./parts";

/**
 * Питання помічникові просто з дашборда.
 *
 * Сенс плитки не в тому, щоб замінити сторінку помічника, а в тому, щоб
 * прибрати два кроки: керівник дивиться на дашборд, у нього виникає
 * питання — і він набирає його там, де вже стоїть курсор. Сама відповідь
 * усе одно живе в розмові: питання їде туди параметром ?q=.
 */

/** Те, що питають найчастіше. Усі троє відповідаються кодом, без токенів. */
const HINTS = ["Хто зараз на маршруті", "Дебіторка по торгових", "Що закінчується на складі"];

export function AssistantAsk() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const ask = (text: string) => {
    const value = text.trim();
    if (!value) return;
    router.push(`/admin/assistant?q=${encodeURIComponent(value)}`);
  };

  return (
    <WidgetBody title="Спитати помічника" hint="Команда, гроші, склад, обмін" href="/admin/assistant" hrefLabel="Відкрити">
      <div className="flex h-full flex-col gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Спитайте про фірму…"
            className="h-10 w-full rounded-xl border border-g200 bg-white px-3 text-[13px] outline-none focus:border-bk"
          />
        </form>
        <div className="flex flex-wrap gap-1.5">
          {HINTS.map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => ask(h)}
              className="rounded-full border border-g200 px-2.5 py-1 text-[12px] text-g600 hover:border-bk hover:text-bk"
            >
              {h}
            </button>
          ))}
        </div>
      </div>
    </WidgetBody>
  );
}
