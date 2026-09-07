"use client";

/**
 * Дрібні частини екрана помічника: репліка, рядок роздумів, слід
 * інструментів, підказки, поле вводу.
 *
 * Окремим файлом, а не п'ятьма: кожна з них — 20-40 рядків розмітки, і
 * тримати їх поруч простіше, ніж ходити між файлами. Логіки тут немає
 * взагалі — усе приходить пропсами.
 */

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Mic, RotateCcw, SendHorizontal, Square, Volume2, VolumeX, Wrench } from "lucide-react";
import AssistantMarkdown from "./AssistantMarkdown";
import { COPY } from "./copy";
import { speak, speechOutputSupported, stopSpeaking } from "./voice";
import { useVoiceInput } from "./useVoiceInput";
import type { ToolTrace, UiMessage } from "./api";

export function MessageBubble({
  message,
  onAsk,
  backHref,
}: {
  message: UiMessage;
  onAsk?: (text: string) => void;
  backHref?: string;
}) {
  if (message.role === "USER") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div
            className={`rounded-2xl rounded-br-md px-3.5 py-2.5 text-[15px] whitespace-pre-wrap break-words ${
              message.failed ? "bg-bad-bg text-bad-fg" : "bg-bk text-white"
            }`}
          >
            {message.content}
          </div>
          {message.failed && (
            <p className="mt-1 text-right text-[11px] font-medium text-bad-fg">{COPY.notSent}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cab-line bg-white p-3.5">
      <AssistantMarkdown content={message.content} onAsk={onAsk} backHref={backHref} />
      <div className="mt-1 flex items-center gap-2">
        <SpeakButton text={message.content} />
        {message.tools.length > 0 && (
          <div className="min-w-0 flex-1">
            <ToolTrace tools={message.tools} viaModel={message.viaModel !== false} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * «Прочитати вголос».
 *
 * Кнопки немає там, де синтезу немає взагалі, — щоб не обіцяти того, чого
 * не буде. Друге натискання зупиняє: відповідь на пів екрана слухати до
 * кінця ніхто не буде.
 */
function SpeakButton({ text }: { text: string }) {
  const [on, setOn] = useState(false);
  const supported = typeof window !== "undefined" && speechOutputSupported();

  useEffect(() => () => stopSpeaking(), []);
  if (!supported) return null;

  return (
    <button
      type="button"
      aria-label={on ? "Зупинити читання" : "Прочитати вголос"}
      onClick={() => {
        if (on) {
          stopSpeaking();
          setOn(false);
          return;
        }
        speak(text);
        setOn(true);
        // Стан повертається сам, коли синтез замовк: окремої події в
        // браузерах на це немає, тому просто опитуємо.
        const timer = setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            setOn(false);
            clearInterval(timer);
          }
        }, 500);
      }}
      className="flex h-7 items-center gap-1 rounded-full border border-cab-line px-2 text-[11px] font-semibold text-cab-t3"
    >
      {on ? <VolumeX size={12} /> : <Volume2 size={12} />}
      {on ? "Стоп" : "Вголос"}
    </button>
  );
}

export function ToolTrace({ tools, viaModel = true }: { tools: ToolTrace[]; viaModel?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2.5 border-t border-[#F1F1EF] pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] font-semibold text-cab-t3"
      >
        <Wrench size={12} />
        {COPY.toolsHeader(tools.length)}
        {!viaModel && <span className="font-normal text-cab-t3">· {COPY.withoutModel}</span>}
        <ChevronDown size={12} className={open ? "rotate-180 transition-transform" : "transition-transform"} />
      </button>
      {open && (
        <ul className="mt-1.5 flex flex-col gap-0.5">
          {tools.map((t, i) => (
            <li key={`${t.name}-${i}`} className="text-[11px] text-cab-t3">
              {t.label}
              {t.ms != null ? ` · ${(t.ms / 1000).toFixed(1)} с` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Рядок «зараз працюю».
 *
 * Секундомір тут не прикраса: хід із інструментами триває 20-40 секунд, і
 * без цифри, що росте, екран виглядає замерзлим. Після 45 секунд додаємо
 * пояснення — інакше людина встигає вирішити, що зламалось.
 */
export function ThinkingRow({
  tools,
  startedAt,
}: {
  tools: Array<ToolTrace & { done: boolean }>;
  startedAt: number;
}) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  const current = [...tools].reverse().find((t) => !t.done) ?? tools[tools.length - 1];
  const label = current?.label ?? COPY.thinking;

  return (
    <div className="rounded-2xl border border-cab-line bg-white p-3.5">
      <span className="flex items-center gap-2 text-sm font-medium text-cab-t2">
        <Dots />
        {label}
        {seconds > 8 && <span className="text-cab-t3">· {seconds} с</span>}
      </span>
      {seconds > 45 && <p className="mt-1.5 text-[11px] text-cab-t3">{COPY.slowHint}</p>}
    </div>
  );
}

function Dots() {
  return (
    <span className="flex gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 animate-pulse rounded-full bg-cab-t3"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

export function ErrorRow({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start gap-2 rounded-2xl border border-bad-line bg-bad-bg p-3.5">
      <span className="flex-1 text-[13px] text-bad-fg">{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex shrink-0 items-center gap-1 text-[13px] font-semibold text-bad-fg underline"
        >
          <RotateCcw size={13} />
          {COPY.retry}
        </button>
      )}
    </div>
  );
}

export function QuickPrompts({
  prompts,
  onPick,
  variant = "strip",
}: {
  prompts: readonly string[];
  onPick: (text: string) => void;
  variant?: "strip" | "list";
}) {
  if (variant === "list") {
    return (
      <div className="flex flex-col gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPick(p)}
            className="flex items-center justify-between gap-2 rounded-xl border border-cab-line bg-white px-3.5 py-3 text-left text-[14px] font-medium text-bk active:opacity-70"
          >
            {p}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {prompts.map((p) => (
        <button
          key={p}
          type="button"
          onClick={() => onPick(p)}
          className="shrink-0 rounded-full border border-cab-line bg-white px-3.5 py-2 text-[13px] font-medium text-cab-t2 active:opacity-70"
        >
          {p}
        </button>
      ))}
    </div>
  );
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  /**
   * Продиктоване лягає В ПОЛЕ, а не летить одразу в чат.
   *
   * Розпізнавання плутає прізвища й артикули, а питання з помилкою
   * коштує цілого ходу моделі. Людина бачить текст і виправляє одним
   * дотиком — або просто тисне «надіслати».
   */
  const voice = useVoiceInput((text) => onChange(text));

  // Поле росте до чотирьох рядків і далі прокручується: питання на пів
  // екрана витіснило б саму розмову.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [value]);

  return (
    <div className="border-t border-cab-line bg-white px-4 py-2.5">
      {voice.error && <p className="mb-1.5 text-[11px] text-bad-fg">{voice.error}</p>}
      {voice.state === "listening" && (
        <p className="mb-1.5 text-[11px] font-semibold text-info-fg">🎤 Слухаю — натисніть ще раз, коли скажете</p>
      )}
      {voice.state === "sending" && (
        <p className="mb-1.5 text-[11px] font-semibold text-cab-t2">⏳ Розпізнаю…</p>
      )}
      <div className="flex items-end gap-2">
      <textarea
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (!busy) onSend();
          }
        }}
        enterKeyHint="send"
        maxLength={1000}
        disabled={busy}
        placeholder={COPY.placeholder}
        // 16px обов'язково: менший шрифт змушує мобільний браузер
        // масштабувати сторінку при фокусі.
        className="max-h-[140px] min-h-[44px] flex-1 resize-none rounded-xl border border-cab-line bg-white px-3 py-2.5 text-base text-bk outline-none placeholder:text-cab-t3 focus:border-bk disabled:bg-cab-bg"
      />
      <button
        type="button"
        aria-label={busy ? COPY.stop : COPY.send}
        onClick={busy ? onStop : onSend}
        disabled={!busy && !value.trim()}
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40 ${
          busy ? "bg-bk text-white" : "bg-primary text-bk"
        }`}
      >
        {busy ? <Square size={16} fill="currentColor" /> : <SendHorizontal size={18} />}
      </button>
      {voice.supported && !busy && (
        <button
          type="button"
          aria-label={voice.state === "listening" ? "Зупинити диктування" : "Сказати питання"}
          onClick={voice.toggle}
          disabled={voice.state === "sending"}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-50 ${
            voice.state === "listening"
              ? "bg-bad-fg text-white"
              : "border border-cab-line text-cab-t2"
          }`}
        >
          <Mic size={18} />
        </button>
      )}
      </div>
    </div>
  );
}
