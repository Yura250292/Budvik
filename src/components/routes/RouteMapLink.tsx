"use client";

/**
 * Готовий маршрут — одним посиланням, яке можна переслати водієві.
 *
 * До цього координати з маршруту діставали руками зі сторони бази, а водій
 * отримував шість окремих посилань «довези мене сюди» — тобто шість
 * маршрутів по одній точці замість одного з шести. Тут вони збираються в
 * одне посилання в тому порядку, який збережено в маршруті.
 *
 * Порядок беремо ЗБЕРЕЖЕНИЙ, а не запропонований оптимізатором: посилання
 * їде людині в месенджер і має збігатися з тим, що водій бачить у себе в
 * чек-листі. Поки варіант не натиснуто «Обрати цей», у маршруті лежить
 * старий порядок — його й віддаємо.
 *
 * Точки без координати в посилання не потрапляють узагалі: Google на них
 * поставив би найближчий збіг за назвою, і водій поїхав би не туди. Скільки
 * їх — сказано вголос, поруч із кнопкою.
 *
 * Але з ТЕКСТУ вони не зникають. Спершу текст перелічував лише те, що ввійшло
 * в посилання, — і клієнт без піна пропадав тихо: водій отримував п'ять точок
 * замість шести й дізнався б про шосту хіба ввечері. Тепер у тексті всі точки
 * в порядку маршруту, з тією ж нумерацією, що в чек-листі водія, а ті, яких
 * Google не веде, помічені: до них їдуть за адресою словами.
 *
 * Сам текст будує lib/routes/driver-message.ts — той самий модуль, яким
 * користується сервер, коли надсилає маршрут у Telegram. Двох копій тут бути
 * не може: водій порівняє повідомлення з кнопкою й повірить свіжішому.
 */

import { useState } from "react";
import { Map as MapIcon } from "lucide-react";
import { MAX_POINTS_PER_LINK } from "@/lib/maps/google-links";
import {
  buildDriverMessage,
  plural,
  points,
  type MessageStop,
} from "@/lib/routes/driver-message";
import { kyivDate } from "@/lib/date/kyiv";

type Stop = MessageStop & {
  id: string;
  sequence: number;
};

export default function RouteMapLink({
  number,
  date,
  driverName,
  stops,
}: {
  number: string;
  date: string;
  driverName: string | null;
  stops: Stop[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  /** Буфер обміну недоступний (не https, заборона браузера) — показуємо текст. */
  const [fallback, setFallback] = useState<string | null>(null);

  // Київська доба маршруту: дата зберігається як 00:00 UTC, і на сервері
  // (він у UTC) наївне форматування дало б сусідній день.
  const { text: messageText, links, withCoords, missing } = buildDriverMessage({
    number,
    day: kyivDate(new Date(date)),
    driverName,
    stops,
  });

  // Одна точка маршруту не робить: Google нема через що вести дорогу.
  if (links.length === 0) {
    return (
      <div className="border-t border-g100 px-5 py-3 text-[12.5px] text-g500">
        Маршрут у Google Maps з’явиться, коли в ньому буде хоча б дві точки з
        координатами
        {missing > 0 && ` (зараз без координат: ${points(missing)})`}.
      </div>
    );
  }

  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setFallback(null);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Копіювання без https або із забороною — не глухий кут: показуємо
      // текст, щоб його можна було виділити пальцем.
      setFallback(text);
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & {
      share?: (data: { title?: string; text?: string }) => Promise<void>;
    };
    if (!nav.share) {
      copy(messageText, "text");
      return;
    }
    try {
      await nav.share({ title: `Маршрут ${number}`, text: messageText });
    } catch {
      // Користувач закрив шторку «поділитися» — це не помилка.
    }
  };

  return (
    <div className="border-t border-g100 bg-g50 px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex cursor-pointer items-center gap-1.5 rounded-[8px] border border-g200 bg-white px-3 py-1.5 text-[13px] font-semibold text-bk hover:bg-g50"
        >
          <MapIcon className="h-4 w-4" aria-hidden />
          Маршрут у Google Maps
        </button>
        <a
          href={links[0].url}
          target="_blank"
          rel="noopener noreferrer"
          className="cursor-pointer rounded-[8px] border border-g200 bg-white px-3 py-1.5 text-[13px] font-semibold text-bk hover:bg-g50"
        >
          Відкрити
        </a>
        <button
          type="button"
          onClick={() => copy(links.length === 1 ? links[0].url : messageText, "link")}
          className="cursor-pointer rounded-[8px] border border-g200 bg-white px-3 py-1.5 text-[13px] font-semibold text-bk hover:bg-g50"
        >
          {copied === "link" ? "Скопійовано ✓" : "Копіювати посилання"}
        </button>
        <button
          type="button"
          onClick={share}
          className="cursor-pointer rounded-[8px] bg-primary px-3 py-1.5 text-[13px] font-bold text-bk hover:bg-primary-hover"
        >
          Надіслати водію
        </button>

        <span className="text-[12px] text-g500">
          {points(withCoords)}
          {links.length > 1 &&
            ` · ${links.length} ${plural(links.length, "частина", "частини", "частин")} по ${MAX_POINTS_PER_LINK}`}
        </span>
        {missing > 0 && (
          <span
            className="rounded-[5px] px-2 py-0.5 text-[11px] font-semibold"
            style={{ background: "#FFFBEB", color: "#92400E", border: "1px solid #FCD34D" }}
          >
            без координат: {missing} — у посилання не потрапили
          </span>
        )}
      </div>

      {open && (
        <div className="mt-3 rounded-[8px] border border-g200 bg-white p-3">
          {links.map((l, i) => (
            <div key={l.url} className="mb-2 last:mb-0">
              {links.length > 1 && (
                // Понад 10 точок Google в одне посилання не бере, тому
                // частини; кожна наступна стартує з останньої точки
                // попередньої, щоб дорога не рвалася.
                <p className="mb-1 text-[12px] font-semibold text-g500">
                  Частина {i + 1} з {links.length} · {points(l.points)}
                </p>
              )}
              <a
                href={l.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block break-all text-[12px] text-[#1D4ED8] underline"
              >
                {l.url}
              </a>
            </div>
          ))}

          <button
            type="button"
            onClick={() => copy(messageText, "text")}
            className="mt-2 cursor-pointer rounded-[8px] border border-g200 bg-white px-3 py-1.5 text-[12.5px] font-semibold text-bk hover:bg-g50"
          >
            {copied === "text" ? "Скопійовано ✓" : "Копіювати списком точок"}
          </button>

          {fallback && (
            <div className="mt-2">
              <p className="mb-1 text-[12px] text-g500">
                Браузер не дав скопіювати — виділіть і скопіюйте вручну:
              </p>
              <textarea
                readOnly
                value={fallback}
                onFocus={(e) => e.currentTarget.select()}
                rows={Math.min(12, fallback.split("\n").length + 1)}
                className="w-full rounded-[8px] border border-g200 p-2 text-[12px] text-bk"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
