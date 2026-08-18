"use client";

/**
 * Кому бот пересилає нові замовлення з сайту.
 *
 * Головна незручність, яку сторінка мусить пояснити чесно: Telegram НЕ дає
 * написати людині за номером телефону. Тому додавання складається з двох
 * кроків — адмін заводить рядок, людина відкриває посилання й тисне «Запустити».
 * До цього моменту рядок висить у стані «очікує», і саме так він і показаний,
 * щоб ніхто не думав, ніби сповіщення вже йдуть.
 */

import { useState } from "react";
import { useSession } from "next-auth/react";
import useSWR from "swr";
import { Card, EmptyState } from "@/components/ui/Card";
import { formatPhoneInput } from "@/lib/phone";

type Recipient = {
  id: string;
  name: string;
  phone: string | null;
  code: string;
  telegramId: string | null;
  telegramUsername: string | null;
  linkedAt: string | null;
  active: boolean;
  createdAt: string;
};

type Payload = {
  recipients: Recipient[];
  botUsername: string;
  botConfigured: boolean;
  groupChatId: string | null;
};

const fetcher = (url: string) =>
  fetch(url).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
    return data;
  });

const BTN =
  "cursor-pointer rounded-[var(--radius-btn)] border border-g200 bg-white px-3 py-1.5 text-[13px] font-medium text-g600 transition-colors duration-150 hover:bg-g50 disabled:cursor-default disabled:opacity-50";

function linkFor(botUsername: string, code: string): string {
  return `https://t.me/${botUsername}?start=oa_${code}`;
}

export default function OrderAlertsPage() {
  const { data: session } = useSession();
  const role = session?.user?.role;

  const { data, error, isLoading, mutate } = useSWR<Payload>("/api/admin/order-alerts", fetcher);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const recipients = data?.recipients ?? [];
  const bot = data?.botUsername ?? "Budvik_Sklad_bot";
  const linkedActive = recipients.filter((r) => r.telegramId && r.active).length;

  const call = async (init: RequestInit & { url?: string }) => {
    setBusy(true);
    try {
      const res = await fetch(init.url ?? "/api/admin/order-alerts", init);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(json.error || "Не вдалося виконати дію");
        return null;
      }
      await mutate();
      return json;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    if (!name.trim()) return;
    const created = await call({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.trim(), phone: phone.trim() }),
    });
    if (created) {
      setName("");
      setPhone("");
    }
  };

  const copy = async (recipient: Recipient) => {
    const text = linkFor(bot, recipient.code);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(recipient.id);
      setTimeout(() => setCopied((c) => (c === recipient.id ? null : c)), 2000);
    } catch {
      // Буфер закритий (http або відмова) — показуємо посилання, щоб скопіювали руками.
      prompt("Скопіюйте посилання:", text);
    }
  };

  if (role && !["ADMIN", "MANAGER"].includes(role)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-bk">Доступ заборонено</h1>
        <p className="mt-2 text-sm text-g400">Список отримувачів ведуть адміністратор і менеджер</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-4 sm:px-6">
      <div className="mb-4">
        <h1 className="text-xl font-bold leading-tight text-bk sm:text-2xl">
          Сповіщення про замовлення
        </h1>
        <p className="text-xs text-g400">
          Кожне нове замовлення з сайту падає цим людям у Telegram
          {linkedActive > 0 ? ` · зараз отримують ${linkedActive}` : " · поки нікому"}
        </p>
      </div>

      {!isLoading && data && !data.botConfigured && (
        <Card className="mb-4 border-[#FFE082] bg-[#FFF8E1]">
          <p className="text-sm font-semibold text-bk">Бот не підключений до сайту</p>
          <p className="mt-1 text-xs text-g600">
            Не заданий <code>TELEGRAM_SKLAD_BOT_TOKEN</code> — поки його немає, сповіщення не
            підуть нікому, скільки б людей не було в списку.
          </p>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50">
          <p className="text-sm text-[#C62828]">Не вдалося завантажити список: {error.message}</p>
        </Card>
      )}

      <Card className="mb-4">
        <h2 className="text-sm font-semibold text-bk">Додати людину</h2>
        <p className="mt-0.5 text-xs text-g500">
          Telegram не дозволяє писати за номером телефону. Тому: заводите людину тут, надсилаєте
          їй посилання — вона тисне «Запустити» в боті й починає отримувати замовлення.
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[180px] flex-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-g400">
              {"Ім'я"}
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="Віктор, менеджер"
              className="mt-1 w-full rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm outline-none focus:border-g300"
            />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="text-[11px] font-medium uppercase tracking-wide text-g400">
              {"Телефон (не обов'язково)"}
            </label>
            <input
              value={phone}
              onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
              onKeyDown={(e) => e.key === "Enter" && add()}
              placeholder="+380 67 123 45 67"
              className="mt-1 w-full rounded-[var(--radius-btn)] border border-g200 px-3 py-2 text-sm outline-none focus:border-g300"
            />
          </div>
          <button
            type="button"
            onClick={add}
            disabled={busy || !name.trim()}
            className="cursor-pointer rounded-[var(--radius-btn)] bg-primary px-4 py-2 text-sm font-semibold text-bk transition-colors duration-150 hover:bg-primary-hover disabled:cursor-default disabled:opacity-50"
          >
            Додати
          </button>
        </div>
      </Card>

      <Card padded={false}>
        {isLoading && !data ? (
          <div className="p-6 text-sm text-g400">Завантаження…</div>
        ) : recipients.length === 0 ? (
          <EmptyState
            title="Список порожній"
            hint="Поки нікого немає, про нові замовлення дізнається лише той, хто сам відкриє адмінку."
          />
        ) : (
          <ul className="divide-y divide-g100">
            {recipients.map((r) => {
              const linked = Boolean(r.telegramId);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-[160px] flex-1">
                    <p className="text-sm font-semibold text-bk">{r.name}</p>
                    <p className="mt-0.5 text-xs text-g500">
                      {r.phone || "без номера"}
                      {r.telegramUsername && ` · @${r.telegramUsername}`}
                    </p>
                  </div>

                  <div className="min-w-[220px] flex-1">
                    {linked ? (
                      <span
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium ${
                          r.active ? "text-[#2E7D32]" : "text-g500"
                        }`}
                      >
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: r.active ? "#2E7D32" : "#9CA3AF" }}
                        />
                        {r.active ? "Отримує замовлення" : "Вимкнено"}
                      </span>
                    ) : (
                      <div className="text-xs">
                        <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                          Чекає, поки натисне «Запустити»
                        </span>
                        <p className="mt-1 break-all text-g500">
                          Код <code className="font-semibold text-bk">{r.code}</code> ·{" "}
                          <a
                            href={linkFor(bot, r.code)}
                            target="_blank"
                            rel="noreferrer"
                            className="underline"
                          >
                            t.me/{bot}
                          </a>
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {!linked && (
                      <button type="button" onClick={() => copy(r)} className={BTN}>
                        {copied === r.id ? "Скопійовано" : "Копіювати посилання"}
                      </button>
                    )}
                    {linked && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            call({
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: r.id, test: true }),
                            }).then((ok) => ok && alert("Надіслано — перевірте Telegram"))
                          }
                          className={BTN}
                        >
                          Перевірка
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            call({
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ id: r.id, active: !r.active }),
                            })
                          }
                          className={BTN}
                        >
                          {r.active ? "Вимкнути" : "Увімкнути"}
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (!confirm(`Прибрати ${r.name} зі списку сповіщень?`)) return;
                        call({ url: `/api/admin/order-alerts?id=${r.id}`, method: "DELETE" });
                      }}
                      className={`${BTN} text-[#C62828]`}
                    >
                      Видалити
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {data?.groupChatId && (
        <p className="mt-3 text-xs text-g400">
          Крім цього списку, копія йде в чат із <code>ORDER_ALERT_CHAT_ID</code> (
          {data.groupChatId}).
        </p>
      )}
    </div>
  );
}
