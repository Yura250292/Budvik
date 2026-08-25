"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader } from "@/components/ui/Card";

/**
 * Роздача тестової збірки застосунку покупця.
 *
 * Той самий підхід, що й для трекера торгових: файл через роут із перевіркою
 * ролі, а не з public/. Причина тут навіть гостріша — застосунок покупця
 * створює справжні замовлення в бойовій базі, тож збірка не має гуляти
 * посиланням.
 *
 * Сторінка живе в адмінці, а не на вітрині: тестують її свої, а покупці
 * отримають застосунок із магазинів, коли він туди доїде.
 */

type Version = { versionCode: number; versionName: string; sizeBytes: number };

const STEPS = [
  {
    title: "Завантажте файл",
    body: "Натисніть кнопку нижче на самому телефоні. Android попередить, що такі файли можуть шкодити — це стандартне попередження для будь-якого APK поза Play Market.",
  },
  {
    title: "Дозвольте встановлення",
    body: "Якщо система скаже «заборонено з цього джерела», відкрийте Налаштування → Дозволити з цього джерела і поверніться назад. Питає один раз.",
  },
  {
    title: "Дозволи в застосунку",
    body: "Камера потрібна для сканера штрихкодів, сповіщення — для статусу замовлення. Геолокацію застосунок не просить взагалі.",
  },
];

export default function MobileAppPage() {
  const [version, setVersion] = useState<Version | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "absent" | "denied">("loading");

  useEffect(() => {
    fetch("/api/app/shop/version")
      .then(async (r) => {
        if (r.status === 401) return setState("denied");
        if (!r.ok) return setState("absent");
        setVersion(await r.json());
        setState("ready");
      })
      .catch(() => setState("absent"));
  }, []);

  const mb = version ? (version.sizeBytes / 1024 / 1024).toFixed(1) : null;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader
          title="Застосунок покупця — тестова збірка"
          hint="Android. Для iPhone потрібен акаунт Apple Developer."
        />

        {state === "loading" ? (
          <p className="text-sm text-g600">Перевіряємо…</p>
        ) : state === "denied" ? (
          <p className="text-sm text-g600">Увійдіть, щоб завантажити збірку.</p>
        ) : state === "absent" ? (
          <div className="rounded-lg border border-g200 bg-g50 p-4">
            <p className="text-sm font-medium text-bk">Збірки ще немає</p>
            <p className="mt-1 text-sm text-g600">
              Файл кладеться в <code className="rounded bg-white px-1">assets/app/Budvik27.apk</code>{" "}
              і їде в репозиторій тим самим комітом, що й версія в цьому роуті.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-g600">
              Версія {version?.versionName} · {mb} МБ
            </p>
            <a
              href="/api/app/shop/download"
              className="mt-4 inline-flex items-center justify-center rounded-lg bg-[#FFD600] px-5 py-3 text-sm font-bold text-[#0A0A0A] transition hover:brightness-95"
            >
              Завантажити APK
            </a>
          </>
        )}
      </Card>

      <Card>
        <CardHeader title="Як встановити" />
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#FFD600] text-xs font-bold text-[#0A0A0A]">
                {i + 1}
              </span>
              <div>
                <p className="text-sm font-medium text-bk">{s.title}</p>
                <p className="mt-0.5 text-sm text-g600">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <Card>
        <CardHeader title="Важливо" />
        <p className="text-sm text-g600">
          Збірка ходить у <strong>бойову базу</strong>. Замовлення, оформлене з неї, справжнє: воно
          списує залишок зі складу й піднімає менеджерів сповіщенням у Telegram. Для проби
          оформлюйте на власне імʼя й одразу скасовуйте — скасування повертає і залишок, і Болти.
        </p>
      </Card>
    </div>
  );
}
