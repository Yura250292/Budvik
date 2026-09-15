"use client";

import { useState } from "react";
import useSWR from "swr";
import { Card, CardHeader } from "@/components/ui/Card";
import { SHARE_ROLE_LIST, type ShareRecipient, type ShareState } from "@/lib/meetings/types";
import { getJson, kyivDateTime, sendJson } from "./api";

/**
 * Надіслати підсумок наради команді — торговим, водіям, складу.
 *
 * У кабінеті людина бачить підсумок, рішення, ключові моменти, відкриті
 * питання, хід по задачах і підтверджені задачі — хто що робить. Запис,
 * транскрипт і «хто говорив» лишаються тут. Облік і доступ —
 * src/lib/meetings/share.ts.
 */

const BTN = "cursor-pointer rounded-[var(--radius-btn)] px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50";
const DARK = `${BTN} bg-bk text-white`;
const LIGHT = `${BTN} border border-g200 bg-white text-g600 hover:bg-g50`;

const GROUP_LABELS: Record<string, string> = { SALES: "Торгові", DRIVER: "Водії", WAREHOUSE: "Склад" };

type ShareReply = { state: ShareState; added?: number; pushed?: number };

/** 1 людина, 2 людини, 5 людей. */
function people(n: number): string {
  const d = n % 10;
  const h = n % 100;
  if (d === 1 && h !== 11) return `${n} людина`;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return `${n} людини`;
  return `${n} людей`;
}

export default function ShareCard({ meetingId, proposed }: { meetingId: string; proposed: number }) {
  const url = `/api/admin/meetings/${meetingId}/share`;
  const { data, error, mutate } = useSWR(url, (u: string) => getJson<ShareReply>(u));
  /** Вибір людей відкрито; null — закрито. */
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const state = data?.state;
  if (error) {
    return (
      <Card>
        <p className="text-[13px] text-red-700">Не вдалося дізнатися, кому надіслано: {error.message}</p>
      </Card>
    );
  }
  if (!state) return null;

  const shared = state.people.filter((p) => p.sharedAt);
  const withoutPush = shared.filter((p) => !p.pushedAt).length;
  const lastShared = shared.reduce<string | null>((a, p) => (!a || (p.sharedAt ?? "") > a ? p.sharedAt : a), null);
  const groups = [
    ...SHARE_ROLE_LIST.map((role) => ({
      key: role,
      label: GROUP_LABELS[role],
      list: state.people.filter((p) => p.role === role),
    })),
    // Кому надіслали, а потім змінили роль — окремо, щоб було видно й можна прибрати.
    {
      key: "OTHER",
      label: "Інші",
      list: state.people.filter((p) => !(SHARE_ROLE_LIST as readonly string[]).includes(p.role)),
    },
  ].filter((g) => g.list.length > 0);

  const run = async (fn: () => Promise<ShareReply>, message: (r: ShareReply) => string | null) => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await fn();
      await mutate({ state: r.state }, { revalidate: false });
      setNotice(message(r));
      return true;
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Не вдалося");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openPicker = async () => {
    setErr(null);
    setNotice(null);
    // Свіжий стан: поки керівник підтверджував задачі, виконавці могли змінитися.
    const fresh = await mutate().catch(() => undefined);
    setPicked(new Set((fresh ?? data)?.state.suggested ?? []));
  };

  const toggle = (ids: string[], on: boolean) => {
    setPicked((prev) => {
      const next = new Set(prev ?? []);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const send = async () => {
    if (!picked || picked.size === 0) return;
    const ok = await run(
      () => sendJson<ShareReply>(url, "POST", { userIds: [...picked] }),
      (r) => {
        const added = r.added ?? 0;
        if (added === 0) return "Ці люди вже мають підсумок";
        if (r.pushed) return `Надіслано: ${people(added)}, пуш пішов`;
        return r.state.pushHours
          ? `Надіслано: ${people(added)}`
          : `Надіслано: ${people(added)}. Зараз поза робочими годинами, тож пуш сам не пішов — підсумок уже в кабінетах. Сповістити людей можна кнопкою «Надіслати пуш».`;
      }
    );
    if (ok) setPicked(null);
  };

  const remove = (p: ShareRecipient | null) => {
    if (!p && !confirm("Прибрати підсумок з кабінетів усіх людей?")) return;
    void run(
      () => sendJson<ShareReply>(p ? `${url}?userId=${encodeURIComponent(p.id)}` : url, "DELETE"),
      () => (p ? `Прибрано в ${p.name}` : "Прибрано з усіх кабінетів")
    );
  };

  return (
    <Card>
      <CardHeader
        title="Команді в кабінети"
        hint="Люди побачать підсумок, рішення, ключові моменти, відкриті питання й підтверджені задачі — хто що робить. Запис, транскрипт і «хто говорив» лишаються тут."
      />

      <div className="flex flex-col gap-3">
        {proposed > 0 && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
            Задач без підтвердження: {proposed}. У кабінетах їх не буде, доки не надішлете — спершу розберіться із
            задачами нижче.
          </p>
        )}

        {shared.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-[13px] text-bk">
              У кабінетах: {people(shared.length)}
              {lastShared && <span className="text-g500"> · востаннє {kyivDateTime(lastShared)}</span>}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {shared.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded-full border border-g200 bg-g50 py-0.5 pl-2.5 pr-1 text-[12px] text-g600"
                >
                  {p.name}
                  {!p.pushedAt && <span className="text-amber-700">· без пуша</span>}
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`Прибрати в ${p.name}`}
                    onClick={() => remove(p)}
                    className="cursor-pointer rounded-full px-1.5 text-g400 hover:text-bk"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-g600">Поки що підсумок бачите лише ви.</p>
        )}

        {picked ? (
          <div className="flex flex-col gap-3 rounded-lg border border-g200 p-3">
            {groups.map((g) => {
              const free = g.list.filter((p) => !p.sharedAt && g.key !== "OTHER");
              const allOn = free.length > 0 && free.every((p) => picked.has(p.id));
              return (
                <div key={g.key}>
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-bk">
                    <input
                      type="checkbox"
                      checked={allOn}
                      disabled={free.length === 0}
                      onChange={() =>
                        toggle(
                          free.map((p) => p.id),
                          !allOn
                        )
                      }
                    />
                    {g.label} · {g.list.length}
                  </label>
                  <div className="mt-1 grid grid-cols-1 gap-1 pl-6 sm:grid-cols-2">
                    {g.list.map((p) => (
                      <label key={p.id} className="flex cursor-pointer items-center gap-2 text-[13px] text-g600">
                        <input
                          type="checkbox"
                          checked={!!p.sharedAt || picked.has(p.id)}
                          disabled={!!p.sharedAt || g.key === "OTHER"}
                          onChange={(e) => toggle([p.id], e.target.checked)}
                        />
                        <span className={p.sharedAt ? "text-g400" : ""}>
                          {p.name}
                          {p.sharedAt ? " · вже має" : ""}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || picked.size === 0} onClick={() => void send()} className={DARK}>
                {busy ? "Надсилаю…" : `Надіслати · ${picked.size}`}
              </button>
              <button type="button" disabled={busy} onClick={() => setPicked(null)} className={LIGHT}>
                Скасувати
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void openPicker()} className={shared.length ? LIGHT : DARK}>
              {shared.length ? "Додати людей" : "Надіслати команді"}
            </button>
            {withoutPush > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (!state.pushHours && !confirm("Зараз поза робочими годинами (08–19). Все одно надіслати пуш?")) return;
                  void run(
                    () => sendJson<ShareReply>(url, "POST", { action: "push" }),
                    (r) => (r.pushed ? `Пуш пішов: ${people(r.pushed)}` : "Усі вже отримали пуш")
                  );
                }}
                className={DARK}
              >
                Надіслати пуш · {withoutPush}
              </button>
            )}
            {shared.length > 0 && (
              <button type="button" disabled={busy} onClick={() => remove(null)} className={LIGHT}>
                Прибрати в усіх
              </button>
            )}
          </div>
        )}

        {err && <p className="text-[12px] text-red-700">{err}</p>}
        {notice && <p className="text-[12px] text-green-700">{notice}</p>}
      </div>
    </Card>
  );
}
