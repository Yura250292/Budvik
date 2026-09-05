"use client";

/**
 * Відповідь помічника як розмітка кабінету.
 *
 * Свій рендерер, а не спільний AiMarkdown із магазину: там кожне посилання
 * відкривається target="_blank", а в WebView застосунку нових вікон немає
 * взагалі — такі посилання просто не спрацьовують. Тут внутрішні адреси
 * йдуть через next/link і відкриваються в тому ж екрані.
 *
 * Друга відмінність — рядок клієнта. Пункт списку, який починається з
 * посилання на картку, малюється як тапабельний рядок із шевроном: план
 * дня перетворюється на список точок, по яких можна ходити пальцем, без
 * жодного власного формату відповіді. Модель просто пише звичайний
 * маркдаун.
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import RoutePicker from "./RoutePicker";

type HastNode = {
  tagName?: string;
  value?: string;
  properties?: { href?: string };
  children?: HastNode[];
};

/** Увесь текст вузла — щоб упізнати рядок підказок за першим символом. */
function plainText(node: unknown): string {
  const n = node as HastNode | undefined;
  if (!n) return "";
  if (typeof n.value === "string") return n.value;
  return (n.children ?? []).map(plainText).join("");
}

/** Адреса картки клієнта в першому ж посиланні пункту. */
function clientHref(node: unknown): string | null {
  const children = (node as HastNode | undefined)?.children ?? [];
  for (const child of children) {
    if (child.tagName === "a") {
      const href = child.properties?.href ?? "";
      return href.startsWith("/sales/clients/") ? href : null;
    }
    // Маркдаун загортає вміст пункту в параграф — заглядаємо на рівень нижче.
    if (child.tagName === "p") return clientHref(child);
  }
  return null;
}

/**
 * Рядок «> 💬 питання · питання» стає кнопками.
 *
 * Помічник відповідає й одразу пропонує, що спитати далі — і це має бути
 * ОДИН тап, а не набирання тексту з телефона в машині. Формат навмисно
 * лишається звичайним маркдауном: у стрічці, у веб-версії та в історії
 * він читається як цитата, а тут перетворюється на кнопки.
 */
export default function AssistantMarkdown({
  content,
  onAsk,
}: {
  content: string;
  onAsk?: (text: string) => void;
}) {
  return (
    <div className="assistant-md text-[14px] leading-relaxed text-bk">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const url = String(href ?? "");
            if (url.startsWith("/")) {
              return (
                <Link href={url} className="font-semibold text-bk underline underline-offset-2">
                  {children}
                </Link>
              );
            }
            return (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-info-fg underline underline-offset-2"
              >
                {children}
              </a>
            );
          },

          li: ({ children, node }) => {
            const href = clientHref(node);
            if (!href) return <li className="ml-4 list-disc py-0.5">{children}</li>;
            return (
              <li className="my-1.5 list-none">
                <span className="flex items-start gap-2 rounded-xl bg-cab-bg px-3 py-2.5">
                  <span className="min-w-0 flex-1 [&_a]:no-underline">{children}</span>
                  <Link href={href} aria-label="Відкрити картку клієнта" className="pt-0.5">
                    <ChevronRight size={16} className="shrink-0 text-cab-t3" />
                  </Link>
                </span>
              </li>
            );
          },

          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          h1: ({ children }) => <Heading>{children}</Heading>,
          h2: ({ children }) => <Heading>{children}</Heading>,
          h3: ({ children }) => <Heading>{children}</Heading>,
          strong: ({ children }) => <strong className="font-bold text-bk">{children}</strong>,
          ol: ({ children }) => <ol className="my-1 flex flex-col">{children}</ol>,
          ul: ({ children }) => <ul className="my-1 flex flex-col">{children}</ul>,
          code: ({ children }) => (
            <code className="rounded bg-cab-bg px-1 py-0.5 text-[13px]">{children}</code>
          ),
          hr: () => <hr className="my-3 border-cab-line" />,

          /**
           * Блок ```budvik-route — це список точок із галочками.
           *
           * Формат навмисно лишається маркдауном: у стрічці, в історії та
           * у веб-версії він читається як службовий блок, а тут стає
           * екраном, де маршрут можна почистити одним дотиком. Так само,
           * як рядок підказок вище стає кнопками.
           */
          pre: ({ children }) => {
            const node = Array.isArray(children) ? children[0] : children;
            const props = (node as { props?: { className?: string; children?: unknown } })?.props;
            if (typeof props?.className === "string" && props.className.includes("budvik-route")) {
              return <RoutePicker json={String(props.children ?? "")} />;
            }
            return (
              <pre className="my-2 overflow-x-auto rounded-xl bg-cab-bg p-3 text-[12px]">
                {children}
              </pre>
            );
          },

          blockquote: ({ children, node }) => {
            const text = plainText(node).trim();
            const asks = text.startsWith("💬")
              ? text.replace(/^💬\s*/, "").split("·").map((q) => q.trim()).filter(Boolean)
              : [];
            if (onAsk && asks.length > 0) {
              return (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {asks.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => onAsk(q)}
                      className="rounded-full border border-cab-line bg-cab-bg px-3 py-1.5 text-left text-[12px] font-medium text-bk"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              );
            }
            return (
              <blockquote className="my-2 border-l-2 border-cab-line pl-3 text-cab-t2">
                {children}
              </blockquote>
            );
          },
          // Таблиця вміщається в екран телефона лише вузька (табло команди,
          // показники проти медіани). Ширшу не забороняємо, але даємо їй
          // горизонтальну прокрутку, щоб вона не ламала сітку сторінки.
          table: ({ children }) => (
            <div className="-mx-3.5 my-2 overflow-x-auto px-3.5">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-cab-line px-2 py-1 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => (
            <td className="border border-cab-line px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function Heading({ children }: { children: ReactNode }) {
  return <p className="mb-1.5 mt-3 text-[15px] font-bold text-bk first:mt-0">{children}</p>;
}
