import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { KYIV_TZ, kyivDate, kyivDayStart, kyivDayEnd } from "@/lib/date/kyiv";

/**
 * Аналітика «Звіти з складу».
 * Агрегація в JS після одного findMany — як в /api/admin/analytics.
 * ВАЖЛИВО: лише читання. Жодних записів у ERP.
 */
export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || !["ADMIN", "MANAGER"].includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const workerId = searchParams.get("workerId");
  const status = searchParams.get("status");

  const dateFilter: Record<string, unknown> = {};
  if (from || to) {
    dateFilter.createdAt = {
      ...(from && { gte: kyivDayStart(from) }),
      ...(to && { lte: kyivDayEnd(to) }),
    };
  }

  const workerFilter = workerId && workerId !== "ALL" ? { userId: workerId } : {};
  const statusFilter = status && status !== "ALL" ? { status: status as never } : {};

  const [reports, shifts, workersList] = await Promise.all([
    prisma.warehouseReport.findMany({
      where: { ...dateFilter, ...workerFilter, ...statusFilter },
      include: {
        user: { select: { id: true, name: true, telegramUsername: true } },
        items: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.warehouseShift.findMany({
      where: {
        ...(from || to
          ? {
              openedAt: {
                ...(from && { gte: kyivDayStart(from) }),
                ...(to && { lte: kyivDayEnd(to) }),
              },
            }
          : {}),
        ...(workerId && workerId !== "ALL" ? { userId: workerId } : {}),
      },
      include: {
        user: { select: { id: true, name: true } },
        _count: { select: { reports: true } },
      },
      orderBy: { openedAt: "desc" },
    }),
    prisma.user.findMany({
      where: { role: "WAREHOUSE" },
      select: { id: true, name: true, telegramId: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // ---- Суми по змінах ----
  const shiftAmounts = new Map<string, number>();
  reports.forEach((r) => {
    if (!r.shiftId || r.status !== "DONE") return;
    shiftAmounts.set(r.shiftId, (shiftAmounts.get(r.shiftId) || 0) + (r.totalAmount || 0));
  });

  // ---- Агрегація по складовщиках ----
  type WorkerAgg = {
    id: string;
    name: string;
    telegramUsername: string | null;
    shiftsCount: number;
    totalHours: number;
    reportsCount: number;
    doneCount: number;
    pendingCount: number;
    failedCount: number;
    totalAmount: number;
    itemsCount: number;
    lastActivityAt: Date | null;
    openShift: { openedAt: Date; openAddress: string | null } | null;
    /** Час усіх накладних працівника — для рівномірності та активних годин */
    reportTimes: Date[];
  };

  const workerMap = new Map<string, WorkerAgg>();

  const ensureWorker = (id: string, name: string, username: string | null): WorkerAgg => {
    let w = workerMap.get(id);
    if (!w) {
      w = {
        id,
        name,
        telegramUsername: username,
        shiftsCount: 0,
        totalHours: 0,
        reportsCount: 0,
        doneCount: 0,
        pendingCount: 0,
        failedCount: 0,
        totalAmount: 0,
        itemsCount: 0,
        lastActivityAt: null,
        openShift: null,
        reportTimes: [],
      };
      workerMap.set(id, w);
    }
    return w;
  };

  reports.forEach((r) => {
    const w = ensureWorker(r.userId, r.user.name, r.user.telegramUsername);
    w.reportsCount++;
    if (r.status === "DONE") {
      w.doneCount++;
      w.totalAmount += r.totalAmount || 0;
      w.itemsCount += r.itemsCount || 0;
    } else if (r.status === "FAILED") {
      w.failedCount++;
    } else {
      w.pendingCount++;
    }
    w.reportTimes.push(r.createdAt);
    if (!w.lastActivityAt || r.createdAt > w.lastActivityAt) w.lastActivityAt = r.createdAt;
  });

  shifts.forEach((s) => {
    const w = ensureWorker(s.userId, s.user.name, null);
    w.shiftsCount++;
    w.totalHours += (s.durationMinutes || 0) / 60;
    if (s.status === "OPEN") {
      w.openShift = { openedAt: s.openedAt, openAddress: s.openAddress };
    }
    if (!w.lastActivityAt || s.openedAt > w.lastActivityAt) w.lastActivityAt = s.openedAt;
  });

  /**
   * Продуктивність. Свідомо рахуємо від ПОЗИЦІЙ, а не від накладних:
   * накладна на 2 рядки і на 40 — різний обсяг роботи.
   *
   * activeHours — час від першої до останньої накладної за день, підсумований
   * по днях. Це чесніше за тривалість зміни: якщо людина відкрила зміну о 8:00,
   * а першу накладну здала о 16:00, зміна триває 8 год, а працювала вона менше.
   */
  const workers = Array.from(workerMap.values())
    .map((w) => {
      // Групуємо накладні по київських днях
      const byDay = new Map<string, Date[]>();
      w.reportTimes.forEach((t) => {
        const d = kyivDate(t);
        const list = byDay.get(d) || [];
        list.push(t);
        byDay.set(d, list);
      });

      let activeHours = 0;
      const gaps: number[] = [];

      byDay.forEach((times) => {
        const sorted = [...times].sort((a, b) => a.getTime() - b.getTime());
        if (sorted.length > 1) {
          activeHours +=
            (sorted[sorted.length - 1].getTime() - sorted[0].getTime()) / 3600000;
          for (let i = 1; i < sorted.length; i++) {
            gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 60000);
          }
        }
      });

      // База для «за годину» — ТРИВАЛІСТЬ ЗМІНИ, а не активні години.
      //
      // Спокуса ділити на activeHours хибна: складовщик, який здав усе
      // одним залпом за 20 хвилин перед закриттям, отримав би 120 позицій/год
      // і виглядав би найкращим. Ділення на зміну показує реальну віддачу
      // за оплачений час.
      const base = w.totalHours > 0 ? w.totalHours : activeHours;

      const avgGap = gaps.length
        ? gaps.reduce((s, g) => s + g, 0) / gaps.length
        : null;

      /**
       * Рівномірність — яку частку зміни людина реально працювала.
       *
       * Свідомо НЕ рахуємо через розкид інтервалів: 9 накладних рівно
       * через 5 хвилин мають ідеальний розкид, але це і є «залп» наприкінці
       * дня. Тому беремо відношення активного вікна до тривалості зміни:
       * працював 8 год зі зміни 8 год → 100%, здав усе за 20 хв → 4%.
       */
      let evenness: number | null = null;
      if (w.doneCount >= 3 && w.totalHours > 0 && activeHours > 0) {
        evenness = Math.round(Math.min(1, activeHours / w.totalHours) * 100);
      }

      return {
        ...w,
        reportTimes: undefined, // назовні не віддаємо — це службові дані
        activeHours: Math.round(activeHours * 10) / 10,
        itemsPerHour: base > 0 ? Math.round((w.itemsCount / base) * 10) / 10 : 0,
        reportsPerHour: base > 0 ? Math.round((w.doneCount / base) * 10) / 10 : 0,
        avgItemsPerReport:
          w.doneCount > 0 ? Math.round((w.itemsCount / w.doneCount) * 10) / 10 : 0,
        avgGapMinutes: avgGap != null ? Math.round(avgGap) : null,
        evenness,
        daysWorked: byDay.size,
        // Частка невдалих розпізнавань — непряма ознака якості фото
        failRate:
          w.reportsCount > 0 ? Math.round((w.failedCount / w.reportsCount) * 100) : 0,
      };
    })
    .sort((a, b) => b.itemsCount - a.itemsCount || b.totalAmount - a.totalAmount);

  // Середні по складу — щоб порівнювати працівника з колективом, а не з нулем
  const activeWorkersList = workers.filter((w) => w.doneCount > 0);
  const teamAvg = {
    itemsPerHour: activeWorkersList.length
      ? Math.round(
          (activeWorkersList.reduce((s, w) => s + w.itemsPerHour, 0) /
            activeWorkersList.length) *
            10
        ) / 10
      : 0,
    itemsPerDay: activeWorkersList.length
      ? Math.round(
          activeWorkersList.reduce(
            (s, w) => s + (w.daysWorked ? w.itemsCount / w.daysWorked : 0),
            0
          ) / activeWorkersList.length
        )
      : 0,
    reportsPerDay: activeWorkersList.length
      ? Math.round(
          (activeWorkersList.reduce(
            (s, w) => s + (w.daysWorked ? w.doneCount / w.daysWorked : 0),
            0
          ) /
            activeWorkersList.length) *
            10
        ) / 10
      : 0,
  };

  // Розподіл накладних по годинах доби — коли на складі пік навантаження
  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, reports: 0 }));
  reports.forEach((r) => {
    const h = Number(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: KYIV_TZ,
        hour: "2-digit",
        hour12: false,
      }).format(r.createdAt)
    );
    if (h >= 0 && h < 24) hourly[h].reports++;
  });

  // ---- Зведення по номенклатурі ----
  // Групуємо за matchedProductId, інакше за нормалізованою назвою —
  // так різні написання в OCR склеюються, якщо товар зіставлено.
  type NomAgg = {
    key: string;
    name: string;
    sku: string | null;
    unit: string | null;
    quantity: number;
    totalSum: number;
    reportsCount: number;
    workers: Set<string>;
    matchedProductId: string | null;
    matchedProductName: string | null;
  };

  const nomMap = new Map<string, NomAgg>();

  reports.forEach((r) => {
    if (r.status !== "DONE") return;
    r.items.forEach((item) => {
      const key = item.matchedProductId || `name:${item.name.trim().toLowerCase()}`;
      let n = nomMap.get(key);
      if (!n) {
        n = {
          key,
          name: item.matchedProductName || item.name,
          sku: item.sku || null,
          unit: item.unit || null,
          quantity: 0,
          totalSum: 0,
          reportsCount: 0,
          workers: new Set(),
          matchedProductId: item.matchedProductId,
          matchedProductName: item.matchedProductName,
        };
        nomMap.set(key, n);
      }
      n.quantity += item.quantity || 0;
      n.totalSum += item.lineTotal || 0;
      n.reportsCount++;
      n.workers.add(r.user.name);
      if (!n.sku && item.sku) n.sku = item.sku;
      if (!n.unit && item.unit) n.unit = item.unit;
    });
  });

  const nomenclature = Array.from(nomMap.values())
    .map((n) => ({
      name: n.name,
      sku: n.sku,
      unit: n.unit,
      quantity: n.quantity,
      avgPrice: n.quantity > 0 ? n.totalSum / n.quantity : 0,
      totalSum: n.totalSum,
      reportsCount: n.reportsCount,
      workers: Array.from(n.workers),
      matchedProductId: n.matchedProductId,
      matchedProductName: n.matchedProductName,
    }))
    .sort((a, b) => b.totalSum - a.totalSum);

  // ---- Динаміка по днях ----
  const dailyMap = new Map<string, { date: string; reports: number; amount: number }>();
  reports.forEach((r) => {
    // Групуємо за київською датою, а не UTC: на Vercel сервер працює в UTC,
    // тож накладна о 00:30 за Києвом інакше потрапила б у попередній день
    const date = kyivDate(r.createdAt);
    let d = dailyMap.get(date);
    if (!d) {
      d = { date, reports: 0, amount: 0 };
      dailyMap.set(date, d);
    }
    d.reports++;
    if (r.status === "DONE") d.amount += r.totalAmount || 0;
  });
  const daily = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // ---- KPI ----
  const doneReports = reports.filter((r) => r.status === "DONE");
  const kpis = {
    totalReports: reports.length,
    totalAmount: doneReports.reduce((s, r) => s + (r.totalAmount || 0), 0),
    totalItems: doneReports.reduce((s, r) => s + (r.itemsCount || 0), 0),
    activeWorkers: workers.filter((w) => w.reportsCount > 0 || w.shiftsCount > 0).length,
    totalShifts: shifts.length,
    totalHours: shifts.reduce((s, sh) => s + (sh.durationMinutes || 0) / 60, 0),
    pending: reports.filter((r) => r.status === "PENDING" || r.status === "PROCESSING").length,
    failed: reports.filter((r) => r.status === "FAILED").length,
  };

  return NextResponse.json({
    kpis,
    workers,
    shifts: shifts.map((s) => ({
      id: s.id,
      userId: s.userId,
      userName: s.user.name,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      durationMinutes: s.durationMinutes,
      openAddress: s.openAddress,
      closeAddress: s.closeAddress,
      openLat: s.openLat,
      openLng: s.openLng,
      closeLat: s.closeLat,
      closeLng: s.closeLng,
      status: s.status,
      reportsCount: s._count.reports,
      reportsAmount: shiftAmounts.get(s.id) || 0,
    })),
    reports: reports.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user.name,
      status: r.status,
      createdAt: r.createdAt,
      photoUrl: r.photoUrl,
      docType: r.docType,
      docNumber: r.docNumber,
      docDate: r.docDate,
      counterpartyName: r.counterpartyName,
      totalAmount: r.totalAmount,
      itemsCount: r.itemsCount,
      batchId: r.batchId,
      errorMessage: r.errorMessage,
    })),
    nomenclature,
    daily,
    hourly,
    teamAvg,
    workersList,
  });
}
