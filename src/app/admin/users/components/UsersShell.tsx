"use client";

/**
 * Розділ «Користувачі» — єдиний центр керування доступами.
 *
 * До цього люди були розкидані по чотирьох екранах: /admin/users (у меню
 * «Клієнти»), /admin/sales (дубль із фільтром по ролі), /admin/sales-reps
 * (робочий профіль торгового) і вкладка «Складовщики» у звітах складу —
 * єдине місце, де підтверджувалися заявки з бота, причому для ОБОХ ролей.
 * Торгові свій вхід туди взагалі втратили, коли /admin/sales-reports став
 * редіректом на аналітику.
 *
 * Розподіл відповідальності після зведення:
 *   тут                     — хто людина, роль, логін, Telegram;
 *   /admin/sales-reps/[id]  — що торговий продає: регіони, клієнти, плани;
 *   /admin/warehouse-reports — скільки складовщик наробив.
 *
 * Список — таблиця в TableScroll, а не стос карток: колонки дають
 * сканованість по вертикалі, а на телефоні працює той самий патерн
 * горизонтального скролу, що й у решті таблиць адмінки.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Avatar } from "@/components/ui/Avatar";
import { TableScroll } from "@/components/ui/TableScroll";
import { RoleSelect } from "@/components/admin/RoleSelect";
import { TelegramBadge } from "@/components/admin/TelegramBadge";
import { LinkRequestCard, type LinkRequest } from "@/components/admin/LinkRequestCard";
import { CreateUserModal } from "@/components/admin/CreateUserModal";
import { CredentialsPanel } from "@/components/admin/CredentialsPanel";
import { formatPrice } from "@/lib/utils";

type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  boltsBalance: number;
  createdAt: string;
  avatarUrl: string | null;
  color: string | null;
  telegramId: string | null;
  telegramUsername: string | null;
  hasPassword: boolean;
  totalSpent: number;
  _count: { orders: number };
};

type WorkerAgg = {
  id: string;
  shiftsCount: number;
  reportsCount: number;
  totalAmount: number;
  openShift: { openedAt: string; openAddress: string | null } | null;
};

const TABS = [
  { key: "all", label: "Усі" },
  { key: "clients", label: "Клієнти", role: "CLIENT" },
  { key: "wholesale", label: "Оптовики", role: "WHOLESALE" },
  { key: "sales", label: "Торгові", role: "SALES" },
  { key: "warehouse", label: "Складовщики", role: "WAREHOUSE" },
  { key: "requests", label: "Заявки з бота" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/** Початок поточного місяця — період за замовчуванням для активності складу. */
function monthStart(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" });
}

export function UsersShell() {
  const { data: session } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const actorRole = (session?.user as { role?: string } | undefined)?.role ?? "";
  const actorId = (session?.user as { id?: string } | undefined)?.id ?? "";
  const isManager = actorRole === "ADMIN" || actorRole === "MANAGER";

  const urlTab = searchParams.get("tab") as TabKey | null;
  const [tab, setTab] = useState<TabKey>(
    urlTab && TABS.some((t) => t.key === urlTab) ? urlTab : "all"
  );

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<LinkRequest[]>([]);
  const [aggregates, setAggregates] = useState<WorkerAgg[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [credentialsFor, setCredentialsFor] = useState<AdminUser | null>(null);

  const fetchUsers = useCallback(async () => {
    const res = await fetch("/api/admin/users");
    const data = await res.json();
    setUsers(Array.isArray(data) ? data : []);
    setLoading(false);
  }, []);

  const fetchRequests = useCallback(async () => {
    const res = await fetch("/api/admin/warehouse-workers");
    if (!res.ok) return;
    const data = await res.json();
    setRequests(Array.isArray(data.requests) ? data.requests : []);
  }, []);

  useEffect(() => {
    if (!isManager) return;
    fetchUsers();
    fetchRequests();
  }, [isManager, fetchUsers, fetchRequests]);

  // Агрегати змін тягнемо лениво і лише для вкладки складу: ендпоінт важкий —
  // він піднімає накладні з позиціями за період.
  useEffect(() => {
    if (!isManager || tab !== "warehouse" || aggregates.length > 0) return;
    fetch(`/api/admin/warehouse-reports?from=${monthStart()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.workers) setAggregates(j.workers);
      })
      .catch(() => {});
  }, [isManager, tab, aggregates.length]);

  // Вкладка в URL: replace, а не push — інакше кожен клік лягав би в історію
  // і «Назад» гортало б власні перемикання.
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    const qs = params.toString();
    router.replace(qs ? `/admin/users?${qs}` : "/admin/users", { scroll: false });
  }, [tab, router]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: users.length };
    for (const t of TABS) {
      if ("role" in t && t.role) map[t.key] = users.filter((u) => u.role === t.role).length;
    }
    map.requests = requests.length;
    return map;
  }, [users, requests]);

  const visible = useMemo(() => {
    const active = TABS.find((t) => t.key === tab);
    const byRole =
      active && "role" in active && active.role
        ? users.filter((u) => u.role === active.role)
        : users;

    if (!search.trim()) return byRole;
    const q = search.toLowerCase();
    return byRole.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.includes(search)) ||
        (u.telegramUsername && u.telegramUsername.toLowerCase().includes(q))
    );
  }, [users, tab, search]);

  const patchUser = (id: string, patch: Partial<AdminUser>) =>
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));

  if (!isManager) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16 text-center font-bold text-red-600">
        Доступ заборонено
      </div>
    );
  }

  const showTelegram = tab === "warehouse" || tab === "sales" || tab === "all";
  const showStats = tab === "all" || tab === "clients" || tab === "wholesale";
  const showAgg = tab === "warehouse";

  // Колонок стільки, скільки увімкнено для вкладки — colSpan порожнього
  // стану і мінімальна ширина скролу рахуються від того самого набору.
  const columnCount = 3 + (showStats ? 2 : 0) + (showAgg ? 1 : 0) + (showTelegram ? 1 : 0);
  const tableMinWidth =
    300 + (showStats ? 190 : 0) + (showAgg ? 210 : 0) + (showTelegram ? 165 : 0) + 145 + 150;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-bk sm:text-2xl">Користувачі</h1>
          <p className="mt-0.5 text-[13px] text-g400">
            Ролі, доступи та підключення до Telegram-бота
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Створити користувача
        </button>
      </div>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav
          className="-mx-4 flex max-w-full gap-0.5 overflow-x-auto px-4 sm:mx-0 sm:w-fit sm:rounded-[var(--radius-btn)] sm:bg-g100 sm:p-1 sm:px-1"
          aria-label="Групи користувачів"
        >
          {TABS.map((t) => {
            const active = tab === t.key;
            const isRequests = t.key === "requests";
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
                  active
                    ? "bg-white text-bk shadow-sm ring-1 ring-g200 sm:ring-0"
                    : "text-g600 hover:text-bk"
                }`}
              >
                {t.label}
                {counts[t.key] > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-px text-[11px] font-semibold tabular-nums ${
                      isRequests && !active
                        ? "bg-amber-100 text-amber-700"
                        : active
                          ? "bg-g100 text-g600"
                          : "bg-g200/70 text-g600"
                    }`}
                  >
                    {counts[t.key]}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {tab !== "requests" && (
          <div className="relative w-full lg:w-80">
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-g400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Ім'я, email, телефон, @username…"
              aria-label="Пошук користувачів"
              className="w-full rounded-[var(--radius-btn)] border border-g300 bg-white py-2 pl-9 pr-8 text-sm text-bk placeholder:text-g400 focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Очистити пошук"
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-0.5 text-g400 transition-colors hover:text-bk"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {tab === "requests" ? (
        <RequestsPanel
          requests={requests}
          candidates={users}
          onApproved={() => {
            fetchRequests();
            fetchUsers();
          }}
        />
      ) : (
        <>
          {tab === "warehouse" && (
            <p className="mb-3 text-xs text-g400">
              Зміни та накладні — за поточний місяць.{" "}
              <Link
                href="/admin/warehouse-reports"
                className="font-semibold text-g600 underline underline-offset-2 transition-colors hover:text-bk"
              >
                Повні звіти складу
              </Link>
            </p>
          )}

          {loading ? (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white">
              <div className="h-9 border-b border-g200 bg-g100/60" />
              <div className="animate-pulse divide-y divide-g100 motion-reduce:animate-none">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="h-9 w-9 shrink-0 rounded-full bg-g200" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3 w-44 rounded bg-g200" />
                      <div className="h-2.5 w-64 rounded bg-g100" />
                    </div>
                    <div className="hidden h-7 w-28 rounded-[8px] bg-g100 sm:block" />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-g200 bg-white">
              <TableScroll minWidth={tableMinWidth}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-g200 bg-g100/60 text-left text-[11px] font-semibold uppercase tracking-wider text-g400">
                      <th scope="col" className="px-4 py-2.5 font-semibold">
                        Користувач
                      </th>
                      {showStats && (
                        <>
                          <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                            Замовлень
                          </th>
                          <th scope="col" className="px-3 py-2.5 text-right font-semibold">
                            Витрачено
                          </th>
                        </>
                      )}
                      {showAgg && (
                        <th scope="col" className="px-3 py-2.5 font-semibold">
                          Активність
                        </th>
                      )}
                      {showTelegram && (
                        <th scope="col" className="px-3 py-2.5 font-semibold">
                          Telegram
                        </th>
                      )}
                      <th scope="col" className="px-3 py-2.5 font-semibold">
                        Роль
                      </th>
                      <th scope="col" className="px-4 py-2.5 text-right font-semibold">
                        <span className="sr-only">Дії</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-g100">
                    {visible.length === 0 ? (
                      <tr>
                        <td colSpan={columnCount} className="px-4 py-14 text-center">
                          <p className="text-sm text-g400">
                            {search.trim()
                              ? `Нікого не знайдено за запитом «${search.trim()}»`
                              : "Користувачів не знайдено"}
                          </p>
                          {search.trim() && (
                            <button
                              type="button"
                              onClick={() => setSearch("")}
                              className="mt-2 cursor-pointer text-sm font-semibold text-g600 underline underline-offset-2 transition-colors hover:text-bk"
                            >
                              Скинути пошук
                            </button>
                          )}
                        </td>
                      </tr>
                    ) : (
                      visible.map((u) => {
                        const agg = aggregates.find((a) => a.id === u.id);
                        return (
                          <tr key={u.id} className="transition-colors hover:bg-g100/40">
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-3">
                                <Avatar
                                  name={u.name}
                                  id={u.id}
                                  src={u.avatarUrl}
                                  color={u.color}
                                  size={34}
                                />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <Link
                                      href={`/admin/users/${u.id}`}
                                      className="truncate font-semibold text-bk transition-colors hover:text-primary-dark"
                                    >
                                      {u.name}
                                    </Link>
                                    {agg?.openShift && (
                                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-green-600">
                                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
                                        на зміні з {timeOnly(agg.openShift.openedAt)}
                                      </span>
                                    )}
                                  </div>
                                  <p className="truncate text-xs text-g400">
                                    {u.email}
                                    {u.phone ? ` · ${u.phone}` : ""}
                                  </p>
                                </div>
                              </div>
                            </td>

                            {showStats && (
                              <>
                                <td
                                  className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                                    u._count.orders === 0 ? "text-g300" : "text-bk"
                                  }`}
                                >
                                  {u._count.orders}
                                </td>
                                <td
                                  className={`px-3 py-2.5 text-right font-semibold tabular-nums ${
                                    u.totalSpent === 0 ? "text-g300" : "text-bk"
                                  }`}
                                >
                                  {formatPrice(u.totalSpent)}
                                </td>
                              </>
                            )}

                            {showAgg && (
                              <td className="px-3 py-2.5">
                                {agg ? (
                                  <>
                                    <p className="whitespace-nowrap text-xs text-g600">
                                      {agg.shiftsCount} змін · {agg.reportsCount} накладних
                                    </p>
                                    <p className="text-xs font-semibold tabular-nums text-bk">
                                      {formatPrice(agg.totalAmount)}
                                    </p>
                                  </>
                                ) : (
                                  <span className="text-g300">—</span>
                                )}
                              </td>
                            )}

                            {showTelegram && (
                              <td className="px-3 py-2.5">
                                {u.telegramId || u.role === "WAREHOUSE" || u.role === "SALES" ? (
                                  <TelegramBadge
                                    userId={u.id}
                                    userName={u.name}
                                    telegramId={u.telegramId}
                                    telegramUsername={u.telegramUsername}
                                    onUnlinked={() =>
                                      patchUser(u.id, { telegramId: null, telegramUsername: null })
                                    }
                                  />
                                ) : (
                                  <span className="text-g300">—</span>
                                )}
                              </td>
                            )}

                            <td className="px-3 py-2.5">
                              <RoleSelect
                                userId={u.id}
                                userName={u.name}
                                role={u.role}
                                actorRole={actorRole}
                                actorId={actorId}
                                onChanged={(next) => patchUser(u.id, { role: next })}
                              />
                            </td>

                            <td className="px-4 py-2.5">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setCredentialsFor(u)}
                                  className={`cursor-pointer whitespace-nowrap rounded-[8px] px-2.5 py-1.5 text-xs font-medium transition-colors ${
                                    u.hasPassword
                                      ? "text-g600 hover:bg-g100 hover:text-bk"
                                      : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                                  }`}
                                >
                                  {u.hasPassword ? "Пароль" : "Задати пароль"}
                                </button>
                                {u.role === "SALES" && (
                                  <Link
                                    href={`/admin/sales-reps/${u.id}`}
                                    className="inline-flex cursor-pointer items-center gap-1 whitespace-nowrap rounded-[8px] px-2.5 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-50"
                                  >
                                    Профіль торгового
                                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                                    </svg>
                                  </Link>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </TableScroll>
            </div>
          )}

          {!loading && visible.length > 0 && (
            <p className="mt-2 text-right text-xs text-g400">
              {search.trim() ? `Знайдено: ${visible.length}` : `Всього: ${visible.length}`}
            </p>
          )}
        </>
      )}

      {creating && (
        <CreateUserModal onClose={() => setCreating(false)} onCreated={fetchUsers} />
      )}
      {credentialsFor && (
        <CredentialsPanel
          userId={credentialsFor.id}
          onClose={() => setCredentialsFor(null)}
          onSaved={fetchUsers}
        />
      )}
    </div>
  );
}

function RequestsPanel({
  requests,
  candidates,
  onApproved,
}: {
  requests: LinkRequest[];
  candidates: AdminUser[];
  onApproved: () => void;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-g200 bg-white p-4 sm:p-5">
      <h2 className="text-base font-bold text-bk">Запити на підключення</h2>
      <p className="mb-3 text-[13px] text-g400">
        Працівник надсилає /start боту @Budvik_Sklad_bot і отримує код із 6 цифр (діє 24
        години). Звіряєте код, обираєте роль — і людина отримує потрібні кнопки в боті.
      </p>

      {requests.length === 0 ? (
        <p className="py-6 text-center text-sm text-g400">
          Активних заявок немає.
        </p>
      ) : (
        requests.map((r) => (
          <LinkRequestCard
            key={r.id}
            request={r}
            candidates={candidates}
            onApproved={onApproved}
          />
        ))
      )}
    </div>
  );
}
