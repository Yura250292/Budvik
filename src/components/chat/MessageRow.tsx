"use client";

/**
 * Одне повідомлення.
 *
 * Свої праворуч чорним, чужі — білою карткою з аватаром: у групі, де пишуть
 * пʼятеро, без імені й кольору неможливо стежити за розмовою. Колір кружка
 * той самий, що на карті напрямків, — людина впізнається одним кольором
 * скрізь.
 */

import AssistantMarkdown from "@/components/sales/assistant/AssistantMarkdown";
import { Avatar } from "@/components/ui/Avatar";
import { audienceLabel } from "@/lib/chat/audience";
import { PhotoGrid } from "./PhotoGrid";
import { COPY } from "./copy";
import type { ChatMessage } from "./api";

const time = (iso: string) =>
  new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });

export function MessageRow({
  message,
  mine,
  section,
  showAudience,
}: {
  message: ChatMessage;
  mine: boolean;
  /** У якому кабінеті читаємо: від цього залежить, чи живі посилання. */
  section: "sales" | "driver" | "warehouse" | "admin";
  /** Показати, кому це було адресовано: у журналі й коли груп кілька. */
  showAudience: boolean;
}) {
  /**
   * Посилання у пересланій відповіді ведуть у кабінет тієї секції, де
   * помічник її написав (/sales/clients/…). У чужій секції вони або впруться
   * в гейт ролі, або відкриють розділ, якого в людини немає, — тому там це
   * лишається текстом.
   */
  const linksAllowed = section !== "warehouse" && message.sourceSection === section;
  const audience = showAudience ? audienceLabel(message) : "";

  const body = (
    <>
      {message.kind === "ASSISTANT" && message.quote && (
        <div className={`rounded-xl border p-2.5 ${mine ? "border-white/15 bg-white/10" : "border-cab-line bg-cab-bg"}`}>
          <p className={`mb-1 text-[11px] font-bold uppercase tracking-wide ${mine ? "text-white/60" : "text-cab-t3"}`}>
            ✨ {COPY.forwarded}
          </p>
          <div className={mine ? "text-white [&_*]:text-white" : ""}>
            <AssistantMarkdown content={message.quote} linksAllowed={linksAllowed} />
          </div>
        </div>
      )}
      {!!message.text && (
        <p className={`whitespace-pre-wrap break-words text-[15px] ${message.kind === "ASSISTANT" && message.quote ? "mt-2" : ""}`}>
          {message.text}
        </p>
      )}
      <PhotoGrid photos={message.photos} />
    </>
  );

  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%]">
          <div className={`rounded-2xl rounded-br-md px-3.5 py-2.5 ${message.failed ? "bg-bad-bg text-bad-fg" : "bg-bk text-white"}`}>
            {body}
          </div>
          <p className="mt-0.5 text-right text-[11px] text-cab-t3">
            {message.failed ? COPY.notSent : message.pending ? "…" : time(message.createdAt)}
            {!!audience && !message.failed && ` · ${audience}`}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Avatar name={message.author.name} id={message.author.id} src={message.author.avatarUrl} color={message.author.color} size={32} />
      <div className="min-w-0 max-w-[85%]">
        <div className="rounded-2xl rounded-bl-md border border-cab-line bg-white px-3.5 py-2.5">
          <p className="mb-0.5 text-[12px] font-bold text-bk">{message.author.name}</p>
          {body}
        </div>
        <p className="mt-0.5 text-[11px] text-cab-t3">
          {time(message.createdAt)}
          {!!audience && ` · ${audience}`}
        </p>
      </div>
    </div>
  );
}
