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
import dynamic from "next/dynamic";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import RoutePicker from "./RoutePicker";
import { BlockPlaceholder, KpiTiles, TreeBlock } from "./AssistantBlocks";
import { BLOCK, parseChart, parseKpi, parseTree } from "@/lib/assistant/blocks";

/**
 * Recharts — лише коли у відповіді справді є діаграма.
 *
 * ssr: false — діаграма міряє ширину контейнера, на сервері її немає.
 */
const AssistantChart = dynamic(() => import("./AssistantChart"), {
  ssr: false,
  loading: () => <BlockPlaceholder label="Діаграма" broken={false} />,
});

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
  backHref,
  linksAllowed = true,
  streaming = false,
}: {
  content: string;
  onAsk?: (text: string) => void;
  /**
   * Адреса цієї розмови. Дописується до кожного внутрішнього посилання,
   * щоб «назад» із картки клієнта повертало сюди, а не в список клієнтів
   * (див. CabinetHeader).
   */
  backHref?: string;
  /**
   * Чи має читач право відкрити картку клієнта.
   *
   * У складі — не має: кабінет торгового закритий гейтом ролі, і посилання
   * вело б у «Доступ заборонено» без дороги назад (нижнього меню складу на
   * чужій секції немає). Текст лишається текстом — відповідь від цього не
   * зменшується, зникає лише глухий кут.
   */
  linksAllowed?: boolean;
  /**
   * Відповідь ще дописується. Недописаний блок діаграми — це обірваний JSON,
   * і до кінця потоку він має показуватись як «малюю», а не як «зламано».
   */
  streaming?: boolean;
}) {
  const withBack = (url: string) => {
    if (!backHref || !url.startsWith("/") || url.includes("back=")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}back=${encodeURIComponent(backHref)}`;
  };
  return (
    <div className="assistant-md text-[14px] leading-relaxed text-bk">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const url = String(href ?? "");
            if (url.startsWith("/")) {
              if (!linksAllowed) return <span className="font-semibold text-bk">{children}</span>;
              return (
                <Link href={withBack(url)} className="font-semibold text-bk underline underline-offset-2">
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
            const href = linksAllowed ? clientHref(node) : null;
            // Маркер (крапка чи номер) бере список-батько: «Що робити» у
            // відповіді керівника нумерований, і номер там — порядок дій.
            if (!href) return <li className="ml-4 py-0.5">{children}</li>;
            return (
              <li className="my-1.5 list-none">
                <span className="flex items-start gap-2 rounded-xl bg-cab-bg px-3 py-2.5">
                  <span className="min-w-0 flex-1 [&_a]:no-underline">{children}</span>
                  <Link href={withBack(href)} aria-label="Відкрити картку клієнта" className="pt-0.5">
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
          // start — бо таблиця посеред нумерованого списку розриває його, і
          // продовження «3.» інакше знову почалося б з одиниці.
          ol: ({ children, start }) => (
            <ol start={start} className="my-1 flex list-decimal flex-col pl-1 marker:font-semibold">
              {children}
            </ol>
          ),
          ul: ({ children }) => <ul className="my-1 flex list-disc flex-col">{children}</ul>,
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
            const lang = typeof props?.className === "string" ? props.className.replace(/^language-/, "") : "";
            const raw = String(props?.children ?? "");
            if (lang === BLOCK.route) {
              return <RoutePicker json={raw} backHref={backHref} />;
            }
            /*
             * Діаграма, плитки й дерево — див. src/lib/assistant/blocks.ts.
             * Зламаний JSON не показуємо сирим: людині він нічого не каже.
             */
            if (lang === BLOCK.chart) {
              const parsed = parseChart(raw);
              return parsed.ok ? <AssistantChart spec={parsed.spec} /> : <BlockPlaceholder label="Діаграма" broken={!streaming} />;
            }
            if (lang === BLOCK.kpi) {
              const parsed = parseKpi(raw);
              return parsed.ok ? <KpiTiles spec={parsed.spec} /> : <BlockPlaceholder label="Показники" broken={!streaming} />;
            }
            if (lang === BLOCK.tree) {
              const parsed = parseTree(raw);
              return parsed.ok ? <TreeBlock spec={parsed.spec} /> : <BlockPlaceholder label="Схема" broken={!streaming} />;
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
