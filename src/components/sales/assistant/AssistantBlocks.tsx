"use client";

/**
 * Легкі блоки відповіді — плитки й дерево показників.
 *
 * Без Recharts, тому живуть окремо від AssistantChart і вантажаться разом
 * зі стрічкою: це кілька div-ів, чекати на них нема чого.
 *
 * Колір тут працює лише як СТАН (добре / погано), і ніколи не сам: поруч
 * завжди стрілка й підпис, бо відповідь читають і з дальтонізмом, і з
 * сонцем на екрані телефона в машині.
 */

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { KpiSpec, Tone, TreeNode, TreeSpec } from "@/lib/assistant/blocks";

const TONE_TEXT: Record<Tone, string> = {
  good: "text-ok-fg",
  bad: "text-bad-fg",
  neutral: "text-cab-t2",
};

function ToneIcon({ tone, delta }: { tone?: Tone; delta: string }) {
  // Напрям — зі знака дельти, а не з тону: «−12 % боргу» — це падіння, але добре.
  const down = /^[−-]/.test(delta.trim());
  const up = /^\+/.test(delta.trim());
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  return <Icon size={12} className={`shrink-0 ${TONE_TEXT[tone ?? "neutral"]}`} aria-hidden />;
}

/**
 * 2–4 головні числа відповіді.
 *
 * Значення — пропорційними цифрами й великим кеглем: це те, що керівник
 * бачить першим, ще до таблиці. Дві колонки на телефоні, чотири на
 * широкому екрані — рядок плиток не переноситься посередині.
 */
export function KpiTiles({ spec }: { spec: KpiSpec }) {
  const cols = spec.items.length >= 3 ? "sm:grid-cols-4" : "sm:grid-cols-2";
  return (
    <div className={`my-2.5 grid grid-cols-2 gap-2 ${cols}`}>
      {spec.items.map((item, i) => {
        /*
         * Дельта — лише зміна зі знаком («+37 %», «−12 тис ₴»). Модель
         * інколи кладе туди пояснення («903 позиції з нулем»), і червоний
         * рядок без знака читається як падіння. Такий текст показуємо
         * приміткою, а колір лишаємо самому значенню стану.
         */
        const signed = item.delta && /^[+−-]/.test(item.delta.trim());
        const hint = [signed ? null : item.delta, item.hint].filter(Boolean).join(" · ");
        return (
          <div key={i} className="min-w-0 rounded-xl border border-cab-line bg-white px-3 py-2.5">
            <p className="truncate text-[11px] font-medium text-cab-t3">{item.label}</p>
            <p
              className={`mt-0.5 font-bold leading-tight ${item.value.length > 11 ? "text-[15px]" : "text-[19px]"} ${
                !signed && item.tone === "bad" ? "text-bad-fg" : !signed && item.tone === "good" ? "text-ok-fg" : "text-bk"
              }`}
            >
              {item.value}
            </p>
            {signed && item.delta && (
              <p className={`mt-1 flex items-center gap-0.5 text-[11px] font-semibold ${TONE_TEXT[item.tone ?? "neutral"]}`}>
                <ToneIcon tone={item.tone} delta={item.delta} />
                <span className="min-w-0 truncate">{item.delta}</span>
              </p>
            )}
            {hint && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-cab-t3" title={hint}>
                {hint}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * «Що від чого залежить» — дерево показників.
 *
 * Зверху результат, нижче — складники або причини, кожен зі своїм числом
 * і зміною. Лінія зліва показує, що до чого належить; дерево йде вниз, а не
 * вбік, тож на телефоні не потребує прокрутки.
 */
export function TreeBlock({ spec }: { spec: TreeSpec }) {
  return (
    <figure className="my-2.5 rounded-xl border border-cab-line bg-white p-2.5">
      <figcaption className="mb-2 text-[13px] font-semibold text-bk">{spec.title}</figcaption>
      <ul>
        <Node node={spec.root} depth={0} />
      </ul>
      {spec.note && <p className="mt-2 text-[11px] leading-snug text-cab-t3">{spec.note}</p>}
    </figure>
  );
}

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  return (
    <li className={depth === 0 ? "" : "relative pl-4 before:absolute before:left-0 before:top-[18px] before:h-px before:w-3 before:bg-cab-line"}>
      <div
        className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg px-2.5 py-1.5 ${
          depth === 0 ? "bg-cab-bg" : "border border-cab-line"
        } my-1`}
      >
        <span className={`min-w-0 text-[13px] ${depth === 0 ? "font-bold" : "font-medium"} text-bk`}>{node.label}</span>
        {node.value && <span className="text-[13px] font-semibold text-bk">{node.value}</span>}
        {node.delta &&
          (/^[+−-]/.test(node.delta.trim()) ? (
            <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${TONE_TEXT[node.tone ?? "neutral"]}`}>
              <ToneIcon tone={node.tone} delta={node.delta} />
              {node.delta}
            </span>
          ) : (
            // Без знака це не зміна, а пояснення — сірим, як у плитках.
            <span className="text-[11px] text-cab-t3">{node.delta}</span>
          ))}
      </div>
      {node.children && node.children.length > 0 && (
        <ul className="ml-2.5 border-l border-cab-line">
          {node.children.map((child, i) => (
            <Node key={i} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** Поки блок ще дописується (стрім), або JSON виявився зламаним. */
export function BlockPlaceholder({ label, broken }: { label: string; broken: boolean }) {
  return (
    <div
      className={`my-2.5 rounded-xl border border-dashed border-cab-line px-3 py-3 text-[12px] ${
        broken ? "text-cab-t3" : "animate-pulse text-cab-t2"
      }`}
    >
      {broken ? `${label}: не вдалося намалювати` : `Малюю: ${label.toLowerCase()}…`}
    </div>
  );
}
