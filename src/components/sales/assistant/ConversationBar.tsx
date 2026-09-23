/**
 * Панель режиму розмови над полем вводу.
 *
 * Людина дивиться на неї краєм ока, тож стан має читатися кольором і рухом,
 * а не текстом: темне коло, що дихає, — слухаю; жовте й більше — чую вас;
 * смужки — говорю. Дотик до панелі, поки помічник говорить, його перебиває.
 */

import { PhoneOff } from "lucide-react";
import type { ConversationState } from "./useConversation";

const LABEL: Record<Exclude<ConversationState, "off">, string> = {
  listening: "Слухаю — питайте",
  hearing: "Чую вас…",
  recognizing: "Розпізнаю…",
  thinking: "Думаю…",
  speaking: "Кажу — торкніться, щоб перебити",
};

function Orb({ state }: { state: ConversationState }) {
  if (state === "speaking") {
    return (
      <span className="flex h-10 w-10 shrink-0 items-center justify-center gap-[3px] rounded-full bg-bk">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="w-[3px] animate-pulse rounded-full bg-primary"
            style={{ height: `${[10, 18, 14, 8][i]}px`, animationDelay: `${i * 120}ms` }}
          />
        ))}
      </span>
    );
  }
  if (state === "recognizing" || state === "thinking") {
    return (
      <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
        <span className="h-10 w-10 animate-spin rounded-full border-[3px] border-cab-line border-t-bk" />
      </span>
    );
  }
  const hearing = state === "hearing";
  return (
    <span className="relative flex h-10 w-10 shrink-0 items-center justify-center">
      <span className={`absolute inset-0 animate-ping rounded-full ${hearing ? "bg-primary/60" : "bg-bk/20"}`} />
      <span
        className={`relative rounded-full transition-all duration-200 ${hearing ? "h-10 w-10 bg-primary" : "h-7 w-7 bg-bk"}`}
      />
    </span>
  );
}

export default function ConversationBar({
  state,
  heard,
  error,
  toolLabel,
  onInterrupt,
  onEnd,
}: {
  state: ConversationState;
  heard: string | null;
  error: string | null;
  toolLabel: string | null;
  onInterrupt: () => void;
  onEnd: () => void;
}) {
  if (state === "off" && !error) return null;

  const label = state === "off" ? "Розмову завершено" : state === "thinking" && toolLabel ? toolLabel : LABEL[state];

  return (
    <div className="px-4 pb-2">
      <div
        role="status"
        aria-live="polite"
        onClick={state === "speaking" ? onInterrupt : undefined}
        className={`flex items-center gap-3 rounded-2xl border border-cab-line bg-white px-3 py-2.5 ${
          state === "speaking" ? "cursor-pointer" : ""
        }`}
      >
        {state !== "off" && <Orb state={state} />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-bk">{label}</p>
          <p className="truncate text-[12px] text-cab-t2">
            {error ? error : heard ? `«${heard}»` : "Скажіть «дякую», щоб завершити"}
          </p>
        </div>
        {state !== "off" && (
          <button
            type="button"
            aria-label="Завершити розмову"
            onClick={(e) => {
              e.stopPropagation();
              onEnd();
            }}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cab-line text-cab-t2"
          >
            <PhoneOff size={17} />
          </button>
        )}
      </div>
    </div>
  );
}
