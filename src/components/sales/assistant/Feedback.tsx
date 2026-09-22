"use client";

/**
 * 👍/👎 під відповіддю помічника — і поле «а як мало бути».
 *
 * Порядок дій навмисний: тап одразу пише присуд у базу, і лише ПОТІМ
 * розгортається поле для пояснення. Половина 👎 ставиться на бігу, і
 * втратити їх через незаповнену форму було б найдорожчою помилкою тут.
 *
 * Поле розгортається під реплікою, а не в шторці: шторка з клавіатурою на
 * телефоні перекриває саму відповідь, про яку треба написати.
 *
 * Після вибору друга кнопка зникає — рядок дій коротшає, а не довшає.
 */

import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { dropVerdict, sendExpected, sendVerdict, type Verdict } from "./api";

const BTN =
  "flex h-7 items-center gap-1 rounded-full border border-cab-line px-2 text-[11px] font-semibold transition-colors";

export default function Feedback({
  messageId,
  initial,
}: {
  messageId: string;
  /** Оцінка, що вже стоїть у базі — щоб не скидалася при поверненні в розмову. */
  initial?: { verdict: "GOOD" | "BAD" | null; expected: string | null } | null;
}) {
  const [verdict, setVerdict] = useState<Verdict | null>(initial?.verdict ?? null);
  const [askWhy, setAskWhy] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(Boolean(initial?.expected));
  const [busy, setBusy] = useState(false);

  async function choose(next: Verdict) {
    if (busy) return;
    setBusy(true);
    const prev = verdict;
    // Показуємо вибір одразу: мережа не має стояти між тапом і відгуком.
    setVerdict(next);
    try {
      if (prev === next) {
        await dropVerdict(messageId);
        setVerdict(null);
        setAskWhy(false);
      } else {
        await sendVerdict(messageId, next);
        setAskWhy(next === "BAD" && !saved);
      }
    } catch {
      setVerdict(prev);
    } finally {
      setBusy(false);
    }
  }

  async function saveWhy() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      await sendExpected(messageId, value);
      setSaved(true);
      setAskWhy(false);
      setText("");
    } catch {
      // Присуд уже збережено — мовчки лишаємо поле відкритим.
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {(verdict === null || verdict === "GOOD") && (
        <button
          type="button"
          onClick={() => void choose("GOOD")}
          aria-label="Відповідь корисна"
          aria-pressed={verdict === "GOOD"}
          className={`${BTN} ${verdict === "GOOD" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "text-cab-t3"}`}
        >
          <ThumbsUp size={12} />
        </button>
      )}
      {(verdict === null || verdict === "BAD") && (
        <button
          type="button"
          onClick={() => void choose("BAD")}
          aria-label="Відповідь неправильна"
          aria-pressed={verdict === "BAD"}
          className={`${BTN} ${verdict === "BAD" ? "border-rose-300 bg-rose-50 text-rose-700" : "text-cab-t3"}`}
        >
          <ThumbsDown size={12} />
        </button>
      )}

      {verdict === "BAD" && !askWhy && !saved && (
        <button type="button" onClick={() => setAskWhy(true)} className={`${BTN} text-cab-t3`}>
          Як мало бути?
        </button>
      )}
      {saved && <span className="text-[11px] text-cab-t3">Дякую, розберу</span>}

      {askWhy && (
        <div className="mt-2 w-full basis-full">
          <textarea
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="А як мало бути? Одним реченням"
            className="w-full rounded-xl border border-cab-line px-3 py-2 text-[13px] outline-none focus:border-cab-t3"
          />
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => void saveWhy()}
              disabled={busy || !text.trim()}
              className={`${BTN} border-cab-t3 text-cab-t1 disabled:opacity-40`}
            >
              Зберегти
            </button>
            <button type="button" onClick={() => setAskWhy(false)} className={`${BTN} text-cab-t3`}>
              Пропустити
            </button>
          </div>
        </div>
      )}
    </>
  );
}
