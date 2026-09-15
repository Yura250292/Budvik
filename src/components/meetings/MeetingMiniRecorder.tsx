"use client";

import { usePathname, useRouter } from "next/navigation";
import { ChevronRight, Mic, Pause, Play, Square } from "lucide-react";
import { formatClock } from "@/lib/meetings/types";
import { useMeetingRecording } from "./MeetingRecordingProvider";

/**
 * Пігулка запису внизу екрана, поки йде нарада, а керівник на іншій сторінці.
 * На самій сторінці запису не показується — там повний пульт.
 *
 * Після «стоп» пігулка не зникає, а нагадує зберегти: зупинений запис живе
 * лише в пам'яті вкладки. Раніше вона гасла разом із записом, і 15.09.2026
 * щойно записану нараду шукали по всій адмінці.
 */
export default function MeetingMiniRecorder() {
  const router = useRouter();
  const pathname = usePathname();
  const { state, elapsedMs, pause, resume, stop } = useMeetingRecording();

  if (state !== "recording" && state !== "paused" && state !== "stopped") return null;
  if (pathname?.startsWith("/admin/meetings/new")) return null;

  if (state === "stopped") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-50 py-1.5 pl-3 pr-1.5 shadow-lg bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6"
      >
        <span className="whitespace-nowrap text-xs font-semibold text-amber-900">Запис наради не збережено</span>
        <button
          type="button"
          onClick={() => router.push("/admin/meetings/new")}
          className="flex cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-full bg-bk px-3 py-1.5 text-xs font-semibold text-white"
        >
          Зберегти
          <ChevronRight size={12} />
        </button>
      </div>
    );
  }

  const active = state === "recording";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed left-1/2 z-40 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-g200 bg-white px-2 py-1.5 shadow-lg bottom-[calc(76px+env(safe-area-inset-bottom))] md:bottom-6"
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-full ${active ? "bg-red-50 text-red-600" : "bg-g50 text-g500"}`}
      >
        <Mic size={15} className={active ? "animate-pulse" : ""} />
      </span>
      <span className={`min-w-[46px] font-mono text-sm font-semibold tabular-nums ${active ? "text-red-600" : "text-bk"}`}>
        {formatClock(elapsedMs)}
      </span>
      {active ? (
        <button
          type="button"
          onClick={pause}
          title="Пауза"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-g50 text-g600"
        >
          <Pause size={14} />
        </button>
      ) : (
        <button
          type="button"
          onClick={resume}
          title="Продовжити"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-bk text-white"
        >
          <Play size={14} />
        </button>
      )}
      <button
        type="button"
        onClick={stop}
        title="Зупинити"
        className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-red-600 text-white"
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        onClick={() => router.push("/admin/meetings/new")}
        className="flex cursor-pointer items-center gap-0.5 rounded-full bg-g50 px-2.5 py-1.5 text-xs font-medium text-g600"
      >
        Нарада
        <ChevronRight size={12} />
      </button>
    </div>
  );
}
