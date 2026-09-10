"use client";

/**
 * Смайлики для повідомлення.
 *
 * Свій набір, а не бібліотека: повний каталог емодзі — це сотні кілобайтів
 * і пошук, якого тут ніхто не питав. У робочому чаті потрібні три десятки
 * знаків, і половина з них — про склад, гроші й дорогу.
 *
 * Останні вжиті лежать у localStorage: людина щодня повторює ті самі
 * пʼять, і шукати їх у сітці щоразу — та сама робота двічі.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

const RECENT_KEY = "budvik.chat.emoji.recent";
const RECENT_MAX = 16;

const GROUPS: Array<{ title: string; items: string[] }> = [
  {
    title: "Робота",
    items: ["📦", "🚚", "🧾", "💰", "💵", "💳", "🔧", "🔩", "🪛", "🧰", "📋", "📸", "📍", "🗺️", "⛽", "🏬", "🏗️", "📊"],
  },
  {
    title: "Відповідь",
    items: ["👍", "👌", "🤝", "✅", "❌", "❗", "❓", "⏳", "🕐", "🔥", "⚠️", "🚫", "💡", "📞", "✍️", "🙏"],
  },
  {
    title: "Настрій",
    items: ["🙂", "😀", "😁", "😂", "😉", "😍", "😎", "🤔", "😐", "😕", "😢", "😡", "😱", "🥳", "😴", "🤯"],
  },
  {
    title: "Люди й місця",
    items: ["👋", "💪", "🙋", "👀", "🧑‍🔧", "🚗", "🏠", "🌧️", "☀️", "❄️", "🌙", "⭐", "🎉", "☕", "🍀", "🇺🇦"],
  },
];

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji: string) {
  try {
    const next = [emoji, ...readRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Приватне вікно або заблоковане сховище — просто без історії.
  }
}

export function EmojiPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [recent, setRecent] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // mousedown, а не click: інакше цей же дотик, яким панель відкрили,
    // одразу її й закриває.
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [onClose]);

  const groups = useMemo(
    () => (recent.length > 0 ? [{ title: "Часто", items: recent }, ...GROUPS] : GROUPS),
    [recent]
  );

  return (
    <div
      ref={rootRef}
      className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-[45vh] overflow-y-auto rounded-2xl border border-cab-line bg-white shadow-[0_-8px_24px_rgba(0,0,0,0.12)]"
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-cab-line bg-white px-3 py-1.5">
        <span className="text-[12px] font-bold text-cab-t2">Смайлики</span>
        <button type="button" onClick={onClose} aria-label="Закрити смайлики" className="flex h-8 w-8 items-center justify-center text-cab-t3">
          <X size={16} />
        </button>
      </div>
      <div className="px-3 pb-3">
        {groups.map((g) => (
          <div key={g.title} className="mt-2">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-cab-t3">{g.title}</p>
            <div className="grid grid-cols-8 gap-0.5">
              {g.items.map((e, i) => (
                <button
                  key={`${g.title}-${e}-${i}`}
                  type="button"
                  onClick={() => {
                    rememberEmoji(e);
                    setRecent(readRecent());
                    onPick(e);
                  }}
                  // 40px: сітка смайликів — найдрібніші цілі на екрані,
                  // і в машині в менші не влучають.
                  className="flex h-10 w-full items-center justify-center rounded-lg text-[22px] leading-none active:bg-cab-bg"
                  aria-label={`Смайлик ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
