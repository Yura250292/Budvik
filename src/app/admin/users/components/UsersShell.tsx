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
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { Avatar } from "@/components/ui/Avatar";
import { RoleSelect } from "@/components/admin/RoleSelect";
import { TelegramBadge } from "@/components/admin/TelegramBadge";
import { LinkRequestCard, type LinkRequest } from "@/components/admin/LinkRequestCard";
import { CreateUserModal } from "@/components/admin/CreateUserModal";
import { CredentialsPanel } from "@/components/admin/CredentialsPanel";
import { roleColor, roleLabel } from "@/lib/roles";
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-bk sm:text-3xl">Користувачі</h1>
          <p className="mt-1 text-sm text-g400">
            Ролі, доступи та підключення до Telegram-бота
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors hover:bg-primary-hover"
        >
          + Створити користувача
        </button>
      </div>

      <nav
        className="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 pb-0.5 sm:mx-0 sm:px-0"
        aria-label="Групи користувачів"
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            aria-current={tab === t.key ? "page" : undefined}
            className={`relative shrink-0 cursor-pointer rounded-[var(--radius-btn)] px-3.5 py-2 text-[13px] font-medium transition-colors ${
              tab === t.key ? "bg-bk text-white" : "text-g600 hover:bg-g100 hover:text-bk"
            }`}
          >
            {t.label}
            {counts[t.key] > 0 && (
              <span
                className={`ml-1.5 text-xs ${
                  t.key === "requests" && tab !== "requests"
                    ? "font-bold text-amber-600"
                    : "opacity-60"
                }`}
              >
                {counts[t.key]}
              </span>
            )}
          </button>
        ))}
      </nav>

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
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за ім'ям, email, телефоном або @username…"
            className="mb-4 w-full rounded-[var(--radius-btn)] border border-g300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />

          {tab === "warehouse" && (
            <p className="mb-3 text-xs text-g400">
              Зміни та накладні — за поточний місяць.{" "}
              <Link href="/admin/warehouse-reports" className="font-semibold underline">
                Повні звіти складу
              </Link>
            </p>
          )}

          {loading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-20 rounded-lg bg-g200" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-lg border bg-white p-12 text-center text-g400">
              Користувачів не знайдено
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((u) => {
                const agg = aggregates.find((a) => a.id === u.id);
                return (
                  <div
                    key={u.id}
                    className="rounded-lg border bg-white p-4 transition-shadow hover:shadow-sm sm:p-5"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar name={u.name} id={u.id} src={u.avatarUrl} color={u.color} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/admin/users/${u.id}`}
                              className="font-semibold text-bk transition-colors hover:text-primary-dark"
                            >
                              {u.name}
                            </Link>
                            {agg?.openShift && (
                              <span className="flex items-center gap-1 text-xs font-semibold text-green-600">
                                <span className="inline-block h-2 w-2 rounded-full bg-green-600" />
                                на зміні з {timeOnly(agg.openShift.openedAt)}
                              </span>
                            )}
                          </div>
                          <p className="truncate text-sm text-g400">{u.email}</p>
                          {u.phone && <p className="text-xs text-g400">{u.phone}</p>}
                          {tab === "warehouse" && agg && (
                            <p className="mt-0.5 text-xs text-g400">
                              {agg.shiftsCount} змін · {agg.reportsCount} накладних ·{" "}
                              {formatPrice(agg.totalAmount)}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 md:gap-5">
                        {(tab === "all" || tab === "clients" || tab === "wholesale") && (
                          <>
                            <div className="text-center">
                              <p className="text-xs text-g400">Замовлень</p>
                              <p className="font-bold text-bk">{u._count.orders}</p>
                            </div>
                            <div className="text-center">
                              <p className="text-xs text-g400">Витрачено</p>
                              <p className="font-bold text-bk">{formatPrice(u.totalSpent)}</p>
                            </div>
                          </>
                        )}

                        {showTelegram && (u.telegramId || u.role === "WAREHOUSE" || u.role === "SALES") && (
                          <TelegramBadge
                            userId={u.id}
                            userName={u.name}
                            telegramId={u.telegramId}
                            telegramUsername={u.telegramUsername}
                            onUnlinked={() =>
                              patchUser(u.id, { telegramId: null, telegramUsername: null })
                            }
                          />
                        )}

                        <span
                          className={`rounded-full px-3 py-1 text-xs font-medium ${roleColor(u.role)} md:hidden`}
                        >
                          {roleLabel(u.role)}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <RoleSelect
                          userId={u.id}
                          userName={u.name}
                          role={u.role}
                          actorRole={actorRole}
                          actorId={actorId}
                          onChanged={(next) => patchUser(u.id, { role: next })}
                        />
                        <button
                          type="button"
                          onClick={() => setCredentialsFor(u)}
                          className="cursor-pointer rounded-[var(--radius-btn)] bg-g100 px-3 py-1.5 text-xs font-medium text-g600 transition-colors hover:bg-g200"
                        >
                          {u.hasPassword ? "Пароль" : "Задати пароль"}
                        </button>
                        {u.role === "SALES" && (
                          <Link
                            href={`/admin/sales-reps/${u.id}`}
                            className="cursor-pointer rounded-[var(--radius-btn)] bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100"
                          >
                            Профіль торгового
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
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
    <div className="rounded-lg border bg-white p-4 sm:p-5">
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
