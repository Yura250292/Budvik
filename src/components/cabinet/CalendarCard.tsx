"use client";

import { useCallback, useEffect, useState } from "react";
import { Body, Button, Card, CardTitle, Note } from "@/components/cabinet/ui";
import { useIsNativeApp } from "@/lib/useIsNativeApp";

/**
 * Картка «Google Календар» у профілі співробітника.
 *
 * Конектор не налаштовано (немає ключів на сервері) — картки немає взагалі,
 * а не кнопка, яка віддає помилку.
 *
 * У застосунку підключення відкривається в системному браузері: Google
 * навмисно не пускає OAuth усередину WebView (disallowed_useragent), і
 * кнопка «як є» показала б людині екран помилки Google.
 */

type Status = {
  enabled: boolean;
  connected?: boolean;
  status?: string | null;
  googleEmail?: string | null;
  lastSyncAt?: string | null;
  calendarReady?: boolean;
  events?: number;
};

/** Що сказати людині після повернення з Google. */
const RESULTS: Record<string, string> = {
  ok: "Календар підключено.",
  denied: "Ви скасували підключення — нічого не змінилось.",
  "no-refresh":
    "Google не дав постійного дозволу. Заберіть доступ Budvik на myaccount.google.com/permissions і спробуйте ще раз.",
  "no-scope": "Не видано доступ до календаря — без нього підключення не працює.",
};

function whenText(iso: string | null | undefined): string {
  if (!iso) return "ще не було";
  return new Date(iso).toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CalendarCard() {
  const [state, setState] = useState<Status | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isApp = useIsNativeApp();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/calendar/status", { cache: "no-store" });
      if (res.ok) setState((await res.json()) as Status);
    } catch {
      // Немає зв'язку — картку просто не показуємо, лаятись нема на що.
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("calendar");
    if (outcome) {
      setResult(RESULTS[outcome] ?? null);
      // Прибираємо мітку з адреси, щоб вона не поверталася при оновленні.
      params.delete("calendar");
      const rest = params.toString();
      window.history.replaceState({}, "", window.location.pathname + (rest ? `?${rest}` : ""));
    }
  }, [load]);

  if (!state?.enabled) return null;

  const connectUrl = `/api/calendar/google/connect?returnTo=${encodeURIComponent(window.location.pathname)}`;
  const needsReconnect = state.status === "NEEDS_RECONNECT";
  const active = state.connected && !needsReconnect;

  async function disconnect() {
    if (!confirm("Відключити календар? Події з сайту перестануть оновлюватись.")) return;
    setBusy(true);
    try {
      await fetch("/api/calendar/disconnect", { method: "POST" });
      await load();
      setResult("Календар відключено. Сам календар «Budvik» лишився у вашому Google — приберіть його там, якщо не потрібен.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card tone={needsReconnect ? "warn" : "plain"} className="space-y-3">
      <CardTitle>Google Календар</CardTitle>

      {result && <Note>{result}</Note>}

      {!state.connected && (
        <>
          <Body>
            Робочий день із сайту — задачі зі строком — з&#39;являтиметься у вашому Google Календарі, в окремому
            календарі «Budvik». Особистих подій застосунок не бачить: у нього є доступ лише до календаря, який він
            створив сам.
          </Body>
          {isApp && (
            <Note>Підключення відкриється в браузері телефона — Google не дозволяє робити це всередині застосунку.</Note>
          )}
          <Button href={connectUrl}>Підключити Google Календар</Button>
        </>
      )}

      {needsReconnect && (
        <>
          <Note tone="warn">
            Доступ до календаря відпав — так буває, якщо забрати його в налаштуваннях Google. Події не оновлюються,
            поки не підключите ще раз.
          </Note>
          <Button href={connectUrl}>Підключити ще раз</Button>
        </>
      )}

      {active && (
        <>
          <Body>
            Акаунт: {state.googleEmail || "—"}
            <br />
            Подій у календарі: {state.events ?? 0}
            <br />
            Останнє оновлення: {whenText(state.lastSyncAt)}
          </Body>
          {!state.calendarReady && <Note>Календар «Budvik» створиться за хвилину-дві після підключення.</Note>}
          <Note>
            Не бачите календар у телефоні? У застосунку Google Календар відкрийте меню → «Налаштування» і увімкніть
            «Budvik»: нові календарі там інколи вимкнені за замовчуванням.
          </Note>
          <Button tone="outline" onClick={() => void disconnect()} disabled={busy}>
            {busy ? "Відключаю…" : "Відключити"}
          </Button>
        </>
      )}
    </Card>
  );
}
