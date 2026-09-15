/**
 * Звіт за день: чому трек ішов або не йшов — проміжками, з доказами.
 *
 * Навіщо. Місяць розборів починався з того самого: «вчора писало, сьогодні
 * ні — чому?». Відповідь щоразу складали руками з чотирьох таблиць (точки,
 * пульси, журнал пристрою, зміни), і 15.09.2026 знадобилася статистика за
 * дванадцять днів, щоб побачити заморожений диспетчер expo. Тут ця робота
 * зроблена раз: зміна ріжеться на п'ятихвилинки, кожна отримує вердикт за
 * найсильнішим доказом, сусідні однакові зливаються в проміжки.
 *
 * Порядок доказів (від сильного до слабкого):
 *   1. точки в проміжку — пише (або доставлено пізніше, якщо прийшли пачкою);
 *   2. нативний маяк (з 1.6.6) — стан диспетчера, служби, лічильники доставки;
 *   3. пульс JS — режим, пачки фіксів, зняте завдання;
 *   4. тиша — і тоді порівнюємо пульси ДО й ПІСЛЯ: той самий контекст без
 *      нових пачок означає, що застосунок жив, але був заморожений.
 */

import { prisma } from "@/lib/prisma";
import { kyivDayStart } from "@/lib/date/kyiv";
import { parseNativeNote } from "./native-diag";

const SLOT_MS = 5 * 60_000;
/** Пульс давніший за це вже не описує проміжок. */
const BEAT_FRESH_MS = 20 * 60_000;
/** Точка, що прийшла на сервер пізніше за цей строк, — «доставлено пізніше». */
const LATE_MS = 15 * 60_000;

export const VERDICT = {
  writing: "пише",
  writingLate: "пише, доставлено пізніше",
  offShift: "поза зміною",
  frozen: "ЗАМОРОЖЕНО: диспетчер не бачить контексту JS",
  taskGone: "завдання локації знято",
  noService: "служба запису не працює",
  noForeground: "служба без переднього плану (Android ріже координати)",
  startRefused: "Android відмовив у запуску служби",
  recordingOff: "запис вимкнено",
  noFixes: "система не дає координат",
  stuckInLocation: "координати не йдуть далі expo-location",
  stuckInScheduler: "JobScheduler не запускає доставку",
  allFiltered: "фікси є, записувач усе відкинув",
  liveNoFixes: "застосунок живий, координат не отримує",
  silentFrozen: "тиша: застосунок живий, але заморожений (той самий контекст, пачок не додалось)",
  silentBeatsLost: "тиша: пульс не доходив, хоча фікси йшли",
  silentRestarted: "тиша: процес або контекст перезапускався",
  silent: "тиша: немає ні пульсу, ні маяка",
} as const;

type Beat = {
  at: Date;
  ctx: number | null;
  batches: number | null;
  mode: string | null;
  status: string | null;
  lastError: string | null;
  version: string | null;
  watchdogAt: Date | null;
};
type Ev = { at: Date; kind: string; note: string | null };

export type DayInterval = {
  from: Date;
  to: Date;
  verdict: string;
  points: number;
  evidence: string[];
};

export type ContextLine = {
  startedAt: Date;
  lastBeat: Date;
  version: string | null;
  beats: number;
  maxBatches: number;
  /** Через скільки секунд після підйому контексту прокинувся сторож. */
  watchdogAfterSec: number | null;
};

export type DayReport = {
  userId: string;
  name: string;
  day: string;
  window: { from: Date; to: Date } | null;
  shifts: Array<{ startedAt: Date; endedAt: Date | null; status: string }>;
  points: number;
  slotsWithPoints: number;
  slots: number;
  intervals: DayInterval[];
  contexts: ContextLine[];
  notable: string[];
  /** Журнал диспетчера з останнього нативного знімка — лише рядки цього дня. */
  dispatcherLog: string[];
};

const hm = (d: Date) =>
  d.toLocaleTimeString("uk-UA", { timeZone: "Europe/Kyiv", hour: "2-digit", minute: "2-digit" });

const NOTABLE_KINDS = new Set([
  "boot",
  "reload",
  "restart",
  "stop",
  "start_failed",
  "start_denied",
  "task_gone",
  "task_error",
  "dispatch_lost",
]);

export async function buildDayReport(userId: string, day: string, now = new Date()): Promise<DayReport> {
  const dayFrom = kyivDayStart(day);
  const dayTo = new Date(dayFrom.getTime() + 864e5);

  const [user, shiftRows, beatRows, eventRows, pointRows, nativeState] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    prisma.shift.findMany({
      where: { userId, startedAt: { gte: new Date(dayFrom.getTime() - 864e5), lt: dayTo } },
      orderBy: { startedAt: "asc" },
      select: { startedAt: true, endedAt: true, status: true },
    }),
    prisma.deviceHeartbeat.findMany({
      where: { userId, at: { gte: new Date(dayFrom.getTime() - 3600_000), lt: new Date(dayTo.getTime() + 3600_000) } },
      orderBy: { at: "asc" },
      select: {
        at: true,
        contextStartedAt: true,
        fixBatches: true,
        mode: true,
        watchdogStatus: true,
        lastError: true,
        appVersion: true,
        watchdogAt: true,
      },
    }),
    prisma.trackEvent.findMany({
      where: { userId, at: { gte: dayFrom, lt: dayTo } },
      orderBy: { at: "asc" },
      select: { at: true, kind: true, note: true },
    }),
    prisma.trackPoint.findMany({
      where: { userId, recordedAt: { gte: dayFrom, lt: dayTo } },
      orderBy: { recordedAt: "asc" },
      select: { recordedAt: true, createdAt: true },
    }),
    prisma.syncState.findUnique({ where: { key: `app:staff:native:${userId}` } }),
  ]);

  const shifts = shiftRows.filter((s) => !s.endedAt || s.endedAt >= dayFrom);
  const beats: Beat[] = beatRows.map((b) => ({
    at: b.at,
    ctx: b.contextStartedAt ? b.contextStartedAt.getTime() : null,
    batches: b.fixBatches,
    mode: b.mode,
    status: b.watchdogStatus,
    lastError: b.lastError,
    version: b.appVersion,
    watchdogAt: b.watchdogAt,
  }));
  const events: Ev[] = eventRows;
  const natives = events.filter((e) => e.kind === "native");
  const points = pointRows;

  const report: DayReport = {
    userId,
    name: user?.name ?? userId,
    day,
    window: null,
    shifts,
    points: points.length,
    slotsWithPoints: 0,
    slots: 0,
    intervals: [],
    contexts: [],
    notable: [],
    dispatcherLog: [],
  };

  // ── Вікно: зміна, а без зміни — від першого до останнього сліду активності.
  const end = now < dayTo ? now : dayTo;
  let from: Date | null = null;
  let to: Date | null = null;
  if (shifts.length) {
    from = new Date(Math.max(dayFrom.getTime(), Math.min(...shifts.map((s) => s.startedAt.getTime()))));
    to = new Date(
      Math.min(end.getTime(), Math.max(...shifts.map((s) => (s.endedAt ?? end).getTime())))
    );
  } else {
    const marks = [
      ...points.map((p) => p.recordedAt.getTime()),
      ...events.filter((e) => e.kind !== "native").map((e) => e.at.getTime()),
      ...beats.filter((b) => b.at >= dayFrom && b.at < dayTo).map((b) => b.at.getTime()),
    ];
    if (marks.length) {
      from = new Date(Math.min(...marks));
      to = new Date(Math.max(...marks));
    }
  }
  if (!from || !to || to <= from) return report;
  report.window = { from, to };

  const inShift = (t: number) =>
    !shifts.length || shifts.some((s) => s.startedAt.getTime() <= t && t < (s.endedAt ?? end).getTime());

  // ── П'ятихвилинки з вердиктом.
  const slot0 = Math.floor(from.getTime() / SLOT_MS) * SLOT_MS;
  const slotVerdicts: Array<{ s: number; e: number; verdict: string; points: number; evidence: string[] }> = [];

  for (let s = slot0; s < to.getTime(); s += SLOT_MS) {
    const e = s + SLOT_MS;
    const ptsIn = points.filter((p) => p.recordedAt.getTime() >= s && p.recordedAt.getTime() < e);
    const late = ptsIn.filter((p) => p.createdAt.getTime() - p.recordedAt.getTime() > LATE_MS).length;
    const evidence: string[] = [];
    const verdict = (() => {
      if (!inShift(s + SLOT_MS / 2)) return VERDICT.offShift;
      if (ptsIn.length) return late * 2 >= ptsIn.length ? VERDICT.writingLate : VERDICT.writing;

      // Нативний маяк — найближчий до кінця проміжку, не старший за 20 хв.
      const natIdx = lastIndexBefore(natives, e);
      const nat = natIdx >= 0 && natives[natIdx].at.getTime() >= s - BEAT_FRESH_MS ? natives[natIdx] : null;
      if (nat) {
        const n = parseNativeNote(nat.note);
        evidence.push(`маяк ${hm(nat.at)}: ${nat.note ?? ""}`);
        const prevNat = natives.slice(0, natIdx).reverse().find((x) => parseNativeNote(x.note).p === n.p);
        if (n.tm && !n.tm.includes("L")) return VERDICT.frozen;
        const hasLoc = (list?: string) => !!list && list.split(",").includes("loc");
        if (n.t !== undefined && !hasLoc(n.t) && !hasLoc(n.ps)) return VERDICT.taskGone;
        if (n.svc === "-") return VERDICT.noService;
        if (n.svc === "+") return VERDICT.noForeground;
        if (prevNat) {
          const p = parseNativeNote(prevNat.note);
          const d = (k: string) => Number(n[k]) - Number(p[k]);
          if (d("qd") > 0 && d("dir") === 0) return VERDICT.frozen;
          if (d("br") === 0) return VERDICT.noFixes;
          if (d("br") > 0 && d("sc") === 0) return VERDICT.stuckInLocation;
          if (d("sc") > 0 && d("jx") === 0) return VERDICT.stuckInScheduler;
        }
      }

      const recentFail = events.find(
        (x) => x.kind === "start_failed" && x.at.getTime() >= s - 30 * 60_000 && x.at.getTime() < e
      );

      const beatIdx = lastIndexBefore(beats, e);
      const beat = beatIdx >= 0 && beats[beatIdx].at.getTime() >= s - BEAT_FRESH_MS ? beats[beatIdx] : null;
      if (beat) {
        evidence.push(
          `пульс ${hm(beat.at)}: контекст ${beat.ctx ? hm(new Date(beat.ctx)) : "—"}, пачок ${beat.batches ?? "—"}, режим ${beat.mode ?? "—"}`
        );
        if (!beat.mode || beat.mode === "NONE") {
          if (recentFail) {
            evidence.push(`${hm(recentFail.at)} start_failed: ${recentFail.note ?? ""}`);
            return VERDICT.startRefused;
          }
          return VERDICT.recordingOff;
        }
        const gone = events.find((x) => x.kind === "task_gone" && x.at.getTime() >= s && x.at.getTime() < e);
        if (beat.status?.includes("ЗАВДАННЯ ЛОКАЦІЇ ЗНЯТО") || gone) return VERDICT.taskGone;
        const prevSame = beats
          .slice(0, beatIdx)
          .reverse()
          .find((b) => b.ctx === beat.ctx);
        const gate = beat.status?.match(/фікси \d+→\d+ \([^)]*\)/)?.[0];
        if (prevSame && (beat.batches ?? 0) > (prevSame.batches ?? 0)) {
          if (gate) evidence.push(gate);
          return VERDICT.allFiltered;
        }
        return VERDICT.liveNoFixes;
      }

      if (recentFail) {
        evidence.push(`${hm(recentFail.at)} start_failed: ${recentFail.note ?? ""}`);
        return VERDICT.startRefused;
      }

      // Тиша: що було ДО і ПІСЛЯ.
      const before = beatIdx >= 0 ? beats[beatIdx] : null;
      const after = beats.find((b) => b.at.getTime() >= e) ?? null;
      if (before && after && before.ctx != null && before.ctx === after.ctx) {
        evidence.push(
          `до: пульс ${hm(before.at)} пачок ${before.batches ?? "—"}; після: пульс ${hm(after.at)} пачок ${after.batches ?? "—"}; контекст ${hm(new Date(before.ctx))}`
        );
        return (after.batches ?? 0) === (before.batches ?? 0) ? VERDICT.silentFrozen : VERDICT.silentBeatsLost;
      }
      if (before && after && before.ctx !== after.ctx) {
        evidence.push(
          `контекст ${before.ctx ? hm(new Date(before.ctx)) : "—"} → ${after.ctx ? hm(new Date(after.ctx)) : "—"} (${after.version ?? ""})`
        );
        return VERDICT.silentRestarted;
      }
      return VERDICT.silent;
    })();

    if (ptsIn.length) report.slotsWithPoints++;
    report.slots++;
    slotVerdicts.push({ s, e, verdict, points: ptsIn.length, evidence });
  }

  // ── Злиття сусідніх однакових.
  for (const v of slotVerdicts) {
    const last = report.intervals[report.intervals.length - 1];
    if (last && last.verdict === v.verdict) {
      last.to = new Date(v.e);
      last.points += v.points;
      for (const ev of v.evidence) if (!last.evidence.includes(ev)) last.evidence.push(ev);
    } else {
      report.intervals.push({
        from: new Date(v.s),
        to: new Date(v.e),
        verdict: v.verdict,
        points: v.points,
        evidence: [...v.evidence],
      });
    }
  }
  for (const i of report.intervals) {
    // Перші й останні докази — найкраще описують межі проміжку.
    if (i.evidence.length > 6) i.evidence = [...i.evidence.slice(0, 3), "…", ...i.evidence.slice(-2)];
  }

  // ── Контексти JS.
  const byCtx = new Map<number, Beat[]>();
  for (const b of beats) {
    if (b.ctx == null || b.at < dayFrom || b.at >= dayTo) continue;
    byCtx.set(b.ctx, [...(byCtx.get(b.ctx) ?? []), b]);
  }
  for (const [ctx, list] of byCtx) {
    const wd = list
      .map((b) => b.watchdogAt?.getTime())
      .filter((t): t is number => t != null && t >= ctx - 3000)
      .sort((a, b) => a - b)[0];
    report.contexts.push({
      startedAt: new Date(ctx),
      lastBeat: list[list.length - 1].at,
      version: list[list.length - 1].version,
      beats: list.length,
      maxBatches: Math.max(...list.map((b) => b.batches ?? 0)),
      watchdogAfterSec: wd != null ? Math.round((wd - ctx) / 1000) : null,
    });
  }
  report.contexts.sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());

  // ── Помітні події.
  let lastExit = "";
  for (const e of events) {
    if (NOTABLE_KINDS.has(e.kind)) {
      report.notable.push(`${hm(e.at)} ${e.kind}${e.note ? ` ${e.note.slice(0, 90)}` : ""}`);
    } else if (e.kind === "native") {
      const n = parseNativeNote(e.note);
      if (n.r && n.r !== "alarm") report.notable.push(`${hm(e.at)} маяк: ${n.r}`);
      if (n.ex && n.ex !== lastExit) {
        if (lastExit) report.notable.push(`${hm(e.at)} процес помирав: ${n.ex}`);
        lastExit = n.ex;
      }
    }
  }

  // ── Журнал диспетчера з останнього знімка.
  if (nativeState?.value) {
    try {
      const parsed = JSON.parse(nativeState.value) as {
        snapshot?: { taskService?: { log?: string[] } | string };
      };
      const ts = parsed.snapshot?.taskService;
      const log = ts && typeof ts === "object" ? ts.log ?? [] : [];
      for (const line of log) {
        const [ms, kind, ...rest] = line.split("|");
        const at = Number(ms);
        if (!Number.isFinite(at) || at < dayFrom.getTime() || at >= dayTo.getTime()) continue;
        report.dispatcherLog.push(`${hm(new Date(at))} ${kind} ${rest.join("|")}`);
      }
    } catch {
      /* знімок пошкоджений — звіт і без нього повний */
    }
  }

  return report;
}

/** Індекс останнього елемента з `at` < межі (масив відсортовано за часом). */
function lastIndexBefore<T extends { at: Date }>(list: T[], before: number): number {
  let lo = 0;
  let hi = list.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].at.getTime() < before) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}
