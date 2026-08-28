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

/**
 * Версія, у якій старий трекер перестав підвисати.
 *
 * До 1.5 кожен фікс GPS тричі перечитував увесь буфер точок із диска — і все
 * це в головному потоці. Поки зв'язок є, буфер малий і цього не видно; у селі
 * він виростає до тисяч точок, і планшет завмирає рівно тоді, коли людина
 * стоїть у клієнта й намагається поставити пін, дописати нотатку чи закрити
 * зміну. Саме так це й виглядало у торгового, який лишився на 1.2.
 */
const TRACKER_FREEZE_FIXED_IN = 1.5;

/** «1.2» → 1.2. Дві частини — більше в трекера й не було. */
function trackerVersion(): number | null {
  if (typeof navigator === "undefined") return null;
  const m = navigator.userAgent.match(/BudvikApp\/([\d.]+)/);
  const v = m ? Number.parseFloat(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

export function UpgradeBanner() {
  const [build, setBuild] = useState<Build | null>(null);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(true);
  /** Стара збірка трекера з відомим підвисанням — кажемо про це прямо. */
  const [freezes, setFreezes] = useState<number | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    // Уже в новій збірці — пропонувати нічого.
    if (/BudvikStaff\//.test(navigator.userAgent)) return;

    setHidden(false);
    const v = trackerVersion();
    if (v !== null && v < TRACKER_FREEZE_FIXED_IN) setFreezes(v);

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

      {/* Не загальне «оновіться», а те, що людина бачить на своєму планшеті
          щодня: у цій збірці застосунок завмирає, коли трек накопичився. */}
      {freezes !== null && (
        <p
          style={{
            fontSize: "13px",
            fontWeight: 600,
            color: "#FCA5A5",
            marginTop: "10px",
            lineHeight: 1.5,
          }}
        >
          У вас Budvik Tracker {freezes}. Саме в ній планшет завмирає на пін, нотатку, фото й
          закриття зміни, коли трек накопичився без зв’язку. У новому застосунку цього немає.
        </p>
      )}

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
