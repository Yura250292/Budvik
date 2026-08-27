"use client";

import { useEffect, useState } from "react";

/**
 * Заклик перейти на нову збірку — просто в кабінеті.
 *
 * Показуємо тут, а не лише на сторінці встановлення, бо туди ніхто не заходить
 * сам. Люди в полі відкривають кабінет усередині старого трекера — і саме там
 * має стояти єдина кнопка, яку треба натиснути. Вони вже увійшли, тож нічого
 * більше від них не потрібно.
 *
 * Кому показувати:
 *  • старий трекер (є місток window.BudvikApp, але мітка збірки не BudvikStaff)
 *    — головна аудиторія;
 *  • звичайний браузер на планшеті чи телефоні;
 *  • НЕ показуємо тим, хто вже в новій збірці: вона оновлюється сама.
 */

type Build = { url: string; versionName: string };

export function UpgradeBanner() {
  const [build, setBuild] = useState<Build | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    // Уже в новій збірці — пропонувати нічого.
    if (/BudvikStaff\//.test(navigator.userAgent)) return;

    setHidden(false);
    fetch("/api/app/staff/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.versionName) setBuild({ url: "", versionName: d.versionName });
      })
      .catch(() => {});
  }, []);

  if (hidden || !build) return null;

  /**
   * Ведемо прямо у сховище, а не на свій роут.
   *
   * WebView старого трекера перехоплює завантаження APK зі свого домену й
   * підставляє замість нього СТАРИЙ застосунок. Посилання на чужий хост він
   * віддає системному браузеру ще до перехоплювача — тому адресу беремо
   * окремим запитом (кукі є) і вже нею ведемо людину.
   */
  const start = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/app/staff/download-url", { cache: "no-store" });
      const d = (await r.json()) as { url?: string; error?: string };
      if (d.url) {
        window.location.href = d.url;
        return;
      }
      alert(d.error ?? "Не вдалося отримати посилання. Спробуйте ще раз.");
    } catch {
      alert("Немає зв’язку. Спробуйте, коли з’явиться мережа.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        background: "#0A0A0A",
        borderRadius: "16px",
        padding: "16px",
        marginBottom: "16px",
        border: "1px solid #FFD600",
      }}
    >
      <span
        style={{
          display: "inline-block",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.04em",
          color: "#0A0A0A",
          background: "#FFD600",
          borderRadius: "6px",
          padding: "3px 8px",
        }}
      >
        НОВИЙ ЗАСТОСУНОК
      </span>

      <p style={{ fontSize: "17px", fontWeight: 700, color: "#FFFFFF", marginTop: "10px" }}>
        Будвік27 Робота {build.versionName}
      </p>
      <p style={{ fontSize: "14px", color: "#9CA3AF", marginTop: "6px", lineHeight: 1.5 }}>
        Замінює Budvik Tracker. Маршрут пишеться навіть там, де немає зв’язку, а відмітку клієнта
        можна поставити без мережі — вона надішлеться сама.
      </p>

      <button
        onClick={start}
        disabled={busy}
        style={{
          display: "block",
          width: "100%",
          marginTop: "14px",
          padding: "14px",
          borderRadius: "12px",
          background: "#FFD600",
          color: "#0A0A0A",
          fontWeight: 700,
          fontSize: "15px",
          border: "none",
        }}
      >
        {busy ? "Готую файл…" : "Встановити новий застосунок"}
      </button>

      {/*
        Найважливіший рядок банера. Старий трекер тримає в буфері точки, які ще
        не доїхали; видалити його одразу — значить стерти їх разом із ним, тобто
        втратити день маршруту.
      */}
      <p style={{ fontSize: "13px", color: "#9CA3AF", marginTop: "12px", lineHeight: 1.5 }}>
        Budvik Tracker поки не видаляйте. Попрацюйте день у новому — і аж тоді зносьте старий.
      </p>
    </div>
  );
}
