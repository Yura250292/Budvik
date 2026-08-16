"use client";

import { useState } from "react";
import QRCode from "react-qr-code";

type RefInfo = {
  code: string;
  url: string;
  referredCount: number;
  recentClients: { id: string; name: string; createdAt: string }[];
};

/**
 * QR-код каталогу для клієнта.
 *
 * Клієнт сканує — відкриває каталог, обирає товар, а при оформленні
 * реєструється і назавжди лишається за цим торговим. Дані тягнемо
 * запитом, а не пропсами: сторінка каталогу кешована на всіх, а код
 * у кожного свій.
 */
export function SalesQrShare() {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<RefInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const openModal = async () => {
    setOpen(true);
    if (info || loading) return;

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/sales/ref-code");
      if (!res.ok) throw new Error();
      setInfo(await res.json());
    } catch {
      setError("Не вдалося отримати код. Спробуйте ще раз.");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!info) return;
    await navigator.clipboard.writeText(info.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const share = async () => {
    if (!info) return;
    // navigator.share є не всюди (десктопний Chrome, WebView) — там просто копіюємо
    if (navigator.share) {
      try {
        await navigator.share({ title: "Каталог Budvik", url: info.url });
        return;
      } catch {
        return; // користувач закрив системне вікно — не помилка
      }
    }
    await copy();
  };

  return (
    <>
      <button
        onClick={openModal}
        className="mb-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[10px] border border-g200 bg-white px-4 text-sm font-bold text-[#0A0A0A] active:bg-g50"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 4h2m2 0h2m-6-4h2m2 0h2"
          />
        </svg>
        QR каталогу для клієнта
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "#F7F7F7" }}>
          <div
            style={{
              background: "linear-gradient(to right, #0A0A0A, #141414, #1A1A1A)",
              borderBottom: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ height: "2px", background: "linear-gradient(to right, transparent, #FFD600, transparent)" }} />
            <div style={{ padding: "12px 16px" }}>
              <div className="flex items-center gap-3">
                <button onClick={() => setOpen(false)} style={{ fontSize: "14px", color: "rgba(255,255,255,0.5)" }}>
                  Закрити
                </button>
                <h2 style={{ fontSize: "18px", fontWeight: 700, flex: 1, textAlign: "center", color: "white" }}>
                  QR для клієнта
                </h2>
                <div style={{ width: "56px" }} />
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-4 py-5">
            <div className="mx-auto max-w-sm">
              {loading && <p className="py-10 text-center text-sm text-g400">Готуємо код…</p>}
              {error && <p className="py-10 text-center text-sm text-red-600">{error}</p>}

              {info && (
                <>
                  <p className="mb-4 text-center text-sm text-g600">
                    Дайте клієнту відсканувати — він відкриє каталог і зможе сам обрати товар.
                    Замовлення піде у ваш оборот.
                  </p>

                  {/* Біле поле навколо коду обов'язкове — інакше камера не зчитує */}
                  <div className="mx-auto mb-4 w-fit rounded-2xl bg-white p-5 shadow-sm">
                    <QRCode value={info.url} size={216} />
                  </div>

                  <p className="mb-4 break-all text-center text-xs text-g400">{info.url}</p>

                  <div className="mb-5 flex gap-2">
                    <button
                      onClick={share}
                      className="flex min-h-12 flex-1 items-center justify-center rounded-[10px] bg-[#FFD600] px-4 text-sm font-bold text-[#0A0A0A] active:bg-[#FFC400]"
                    >
                      Поділитись
                    </button>
                    <button
                      onClick={copy}
                      className="flex min-h-12 flex-1 items-center justify-center rounded-[10px] border border-g200 bg-white px-4 text-sm font-bold text-[#0A0A0A] active:bg-g50"
                    >
                      {copied ? "Скопійовано ✓" : "Скопіювати лінк"}
                    </button>
                  </div>

                  <div className="rounded-xl border border-g200 bg-white p-4">
                    <p className="mb-1 text-sm font-bold text-[#0A0A0A]">
                      Приведено клієнтів: {info.referredCount}
                    </p>
                    {info.recentClients.length === 0 ? (
                      <p className="text-xs text-g400">
                        Поки нікого. Клієнт зʼявиться тут після реєстрації за вашим QR.
                      </p>
                    ) : (
                      <ul className="mt-2 space-y-1.5">
                        {info.recentClients.map((c) => (
                          <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="truncate text-g600">{c.name}</span>
                            <span className="shrink-0 text-xs text-g400">
                              {new Date(c.createdAt).toLocaleDateString("uk-UA")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
