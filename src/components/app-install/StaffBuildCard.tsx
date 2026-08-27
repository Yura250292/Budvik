"use client";

import { useEffect, useState } from "react";

/**
 * Картка нової робочої збірки на сторінках /sales/app і /driver/app.
 *
 * Один компонент на дві сторінки: текст переходу з трекера мусить бути
 * однаковий для торгового й водія — це той самий APK і той самий порядок дій.
 * Розбіжність у формулюваннях тут коштувала б дзвінків «а мені написано інше».
 *
 * Поки збірки в сховищі немає, роут віддає 503, і картка не показується взагалі.
 * Показати кнопку, яка нічого не завантажить, гірше, ніж не показати нічого:
 * людина вирішує, що зламався сайт, і йде питати.
 */

type StaffBuild = { versionName: string; sizeBytes: number };

export function StaffBuildCard() {
  const [build, setBuild] = useState<StaffBuild | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/app/staff/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.versionName) setBuild(d);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!build) return null;

  const mb = (build.sizeBytes / 1024 / 1024).toFixed(1);

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: "#FFFFFF", border: "1px solid #E5E7EB", marginBottom: "16px" }}
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
        НОВА ЗБІРКА
      </span>

      <p style={{ fontSize: "17px", fontWeight: 700, color: "#0A0A0A", marginTop: "10px" }}>
        Будвік27 Робота {build.versionName}
      </p>
      <p style={{ fontSize: "14px", color: "#6B7280", marginTop: "6px", lineHeight: 1.5 }}>
        Замінює Budvik Tracker: той самий кабінет і той самий запис маршруту, але
        застосунок один. {mb} МБ.
      </p>

      <a
        href="/api/app/staff/download"
        style={{
          display: "block",
          marginTop: "16px",
          padding: "14px",
          borderRadius: "12px",
          background: "#0A0A0A",
          color: "#FFFFFF",
          fontWeight: 700,
          fontSize: "15px",
          textAlign: "center",
        }}
      >
        Завантажити нову збірку
      </a>

      {/*
        Старий трекер зносимо не одразу, а після першої вдалої зміни: поки в
        його буфері лежать невідправлені точки, видалення застосунку стирає
        разом із ним і їх — тобто день маршруту.
      */}
      <p style={{ fontSize: "13px", color: "#6B7280", marginTop: "12px", lineHeight: 1.5 }}>
        Budvik Tracker поки не видаляйте. Зробіть у новій збірці одну зміну від
        початку до кінця — і аж тоді зносьте старий: у ньому можуть лежати ще не
        надіслані точки маршруту.
      </p>
    </div>
  );
}
