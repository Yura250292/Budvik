"use client";

/**
 * Картка файла, який сформував помічник: назва, скільки рядків, кнопка.
 *
 * Звичайний <a download>, а не next/link: адреса веде в роут, що віддає
 * байти, і маршрутизатор Next намагався б «мʼяко» відкрити його як
 * сторінку. Повторне натискання просто завантажує файл ще раз.
 */

import { Download, FileSpreadsheet, FileText } from "lucide-react";
import type { FileSpec } from "@/lib/assistant/blocks";

const LABEL: Record<FileSpec["format"], string> = {
  xlsx: "Excel",
  xlsx_1c: "Excel для 1С",
  pdf: "PDF",
};

export default function FileCard({ spec }: { spec: FileSpec }) {
  const Icon = spec.format === "pdf" ? FileText : FileSpreadsheet;
  const tint = spec.format === "pdf" ? "bg-bad-bg text-bad-fg" : "bg-ok-bg text-ok-fg";
  return (
    <a
      href={spec.url}
      download={spec.name}
      className="my-2.5 flex items-center gap-3 rounded-xl border border-cab-line bg-white px-3 py-2.5 no-underline"
    >
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tint}`}>
        <Icon size={20} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 break-all text-[13px] font-semibold leading-snug text-bk">{spec.name}</span>
        <span className="block text-[11px] text-cab-t3">
          {LABEL[spec.format]}
          {spec.rows > 0 ? ` · ${spec.rows.toLocaleString("uk-UA")} рядків` : ""}
          {spec.sizeKb > 0 ? ` · ${spec.sizeKb.toLocaleString("uk-UA")} КБ` : ""}
        </span>
      </span>
      <span className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-bk px-3 text-[12px] font-semibold text-white">
        <Download size={14} aria-hidden />
        Завантажити
      </span>
    </a>
  );
}
