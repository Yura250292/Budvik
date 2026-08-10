"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice } from "@/lib/utils";

type AttainmentRow = {
  repId: string;
  brandId: string | null;
  actual: number;
  target: number;
  attainment: number;
};

type Candidate = {
  id: string;
  name: string;
  email: string;
  role: string;
  hasPassword: boolean;
};

export default function SalesRepsAdminPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Додавання торгового: або підняти наявного користувача, або створити нового
  const [showAdd, setShowAdd] = useState(false);
  const [addMode, setAddMode] = useState<"link" | "create">("link");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [pickedUserId, setPickedUserId] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // Оборот і % плану за поточний місяць, ключ — repId.
  // Джерело те саме, що й у «Аналітиці торгових» (lib/analytics/facts.ts),
  // тож цифри тут і там збігаються.
  const [totals, setTotals] = useState<Map<string, AttainmentRow>>(new Map());

  const role = (session?.user as any)?.role;

  const loadReps = useCallback(() => {
    return fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers((Array.isArray(data) ? data : []).filter((u: any) => u.role === "SALES"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!["ADMIN", "MANAGER"].includes(role)) return;
    loadReps();
  }, [role, loadReps]);

  const openAdd = async () => {
    setShowAdd(true);
    setAddError(null);
    const res = await fetch("/api/admin/sales-reps");
    if (res.ok) setCandidates(await res.json());
  };

  const submitAdd = async () => {
    setAddSaving(true);
    setAddError(null);

    const payload =
      addMode === "link"
        ? { mode: "link", userId: pickedUserId, ...(newPassword ? { password: newPassword } : {}) }
        : { mode: "create", name: newName.trim(), email: newEmail.trim(), password: newPassword };

    const res = await fetch("/api/admin/sales-reps", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setAddSaving(false);

    if (!res.ok) {
      setAddError(data.error || "Не вдалося зберегти");
      return;
    }

    // Тезка в 1С — не привід не створювати, але адмін має про це знати одразу.
    if (data.warning) alert(data.warning);

    setShowAdd(false);
    setPickedUserId("");
    setNewName("");
    setNewEmail("");
    setNewPassword("");
    setCandidateSearch("");
    await loadReps();
  };

  useEffect(() => {
    if (!["ADMIN", "MANAGER"].includes(role)) return;
    // Показники — річ допоміжна: якщо ендпоінт впаде, список торгових
    // усе одно має відкритися, тож помилку просто ковтаємо.
    fetch("/api/admin/sales-plans/attainment")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const rows: AttainmentRow[] = Array.isArray(data?.rows) ? data.rows : [];
        // brandId === null — це підсумковий рядок по торговому (не по бренду).
        setTotals(new Map(rows.filter((r) => r.brandId === null).map((r) => [r.repId, r])));
      })
      .catch(() => {});
  }, [role]);

  if (!["ADMIN", "MANAGER"].includes(role)) {
    return <div className="min-h-screen flex items-center justify-center"><p className="text-lg font-bold">Доступ заборонено</p></div>;
  }

  return (
    <div className="min-h-screen" style={{ background: "#F7F7F7" }}>
      <header className="sticky top-0 z-50 bg-white" style={{ borderBottom: "1px solid #EFEFEF", padding: "16px 24px" }}>
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/admin" className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "#FFD600" }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="#0A0A0A" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <div>
              <h1 style={{ fontSize: "26px", fontWeight: 700, color: "#0A0A0A" }}>Торгові представники</h1>
              <p style={{ fontSize: "14px", color: "#6B7280" }}>Призначення регіонів, клієнтів, категорій товарів</p>
            </div>
          </div>
          <button onClick={openAdd}
            style={{ padding: "10px 20px", borderRadius: "10px", fontWeight: 700, fontSize: "14px", background: "#FFD600", color: "#0A0A0A", border: "none", whiteSpace: "nowrap" }}>
            + Додати торгового
          </button>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 sm:px-6" style={{ paddingTop: "24px", paddingBottom: "40px" }}>
        {loading ? (
          <div className="text-center py-12" style={{ color: "#9CA3AF" }}>Завантаження...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-12"><p style={{ color: "#9CA3AF" }}>Торгових не знайдено. Натисніть «Додати торгового».</p></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {users.map((u) => {
              const t = totals.get(u.id);
              return (
              <div key={u.id} className="bg-white rounded-xl p-5"
                style={{ border: "1px solid #EFEFEF", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <Link href={`/admin/sales-reps/${u.id}`}
                  className="flex items-center gap-4 hover:opacity-80 transition-opacity"
                  style={{ textDecoration: "none" }}>
                  <div className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: "#FFF7ED", color: "#D97706", fontWeight: 700, fontSize: "18px" }}>
                    {u.name?.charAt(0)?.toUpperCase() || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p style={{ fontSize: "16px", fontWeight: 600, color: "#0A0A0A" }} className="truncate">{u.name}</p>
                    <p style={{ fontSize: "13px", color: "#6B7280" }}>{u.email}</p>
                    {u.phone && <p style={{ fontSize: "13px", color: "#9CA3AF" }}>{u.phone}</p>}
                  </div>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="#D1D5DB" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </Link>

                {/* Показники за поточний місяць */}
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div className="rounded-lg p-3" style={{ background: "#F9FAFB" }}>
                    <p style={{ fontSize: "11px", color: "#6B7280", fontWeight: 600 }}>ОБОРОТ ЗА МІСЯЦЬ</p>
                    <p style={{ fontSize: "18px", fontWeight: 700 }}>{formatPrice(t?.actual ?? 0)}</p>
                  </div>
                  <div className="rounded-lg p-3" style={{ background: t && t.target > 0 ? "#F0FDF4" : "#F9FAFB" }}>
                    <p style={{ fontSize: "11px", color: t && t.target > 0 ? "#16A34A" : "#6B7280", fontWeight: 600 }}>ВИКОНАННЯ ПЛАНУ</p>
                    <p style={{ fontSize: "18px", fontWeight: 700, color: t && t.target > 0 ? "#16A34A" : "#9CA3AF" }}>
                      {t && t.target > 0 ? `${Math.round(t.attainment)}%` : "плану немає"}
                    </p>
                  </div>
                </div>

                <Link href={`/admin/sales-analytics/${u.id}`}
                  className="block mt-3 text-center"
                  style={{ padding: "8px 16px", borderRadius: "8px", border: "1px solid #E5E7EB", fontSize: "13px", fontWeight: 600, color: "#0A0A0A", textDecoration: "none" }}>
                  Аналітика →
                </Link>
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Додавання торгового */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl w-full max-w-md mx-4" onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "85vh", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #EFEFEF" }}>
              <div className="flex items-center justify-between">
                <h3 style={{ fontSize: "16px", fontWeight: 700 }}>Додати торгового</h3>
                <button onClick={() => setShowAdd(false)} style={{ fontSize: "20px", color: "#9CA3AF", border: "none", background: "none" }}>&times;</button>
              </div>
            </div>

            <div style={{ padding: "16px 20px", overflowY: "auto" }}>
              {/* Вибір режиму */}
              <div className="flex gap-2 mb-5">
                {([
                  { key: "link" as const, label: "Наявний користувач" },
                  { key: "create" as const, label: "Створити нового" },
                ]).map((m) => (
                  <button key={m.key} onClick={() => { setAddMode(m.key); setAddError(null); }}
                    style={{
                      flex: 1, padding: "10px 12px", borderRadius: "10px", fontSize: "13px", fontWeight: 600, border: "none",
                      background: addMode === m.key ? "#0A0A0A" : "#F3F4F6",
                      color: addMode === m.key ? "#FFD600" : "#6B7280",
                    }}>
                    {m.label}
                  </button>
                ))}
              </div>

              {addMode === "link" ? (
                <>
                  <p style={{ fontSize: "13px", color: "#6B7280", marginBottom: "12px" }}>
                    Користувач отримає роль SALES і збереже свій пароль, замовлення та історію.
                  </p>

                  <input type="search" placeholder="Пошук за іменем або email..."
                    value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)}
                    style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px", marginBottom: "10px" }} />

                  <div style={{ maxHeight: "260px", overflowY: "auto", marginBottom: "14px" }}>
                    {candidates.length === 0 ? (
                      <p style={{ textAlign: "center", color: "#9CA3AF", padding: "20px", fontSize: "14px" }}>
                        Немає користувачів, яких можна зробити торговими
                      </p>
                    ) : (
                      candidates
                        .filter((c) => {
                          if (!candidateSearch.trim()) return true;
                          const q = candidateSearch.toLowerCase();
                          return c.name?.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
                        })
                        .slice(0, 50)
                        .map((c) => (
                          <button key={c.id} onClick={() => setPickedUserId(c.id)}
                            className="w-full text-left p-3 rounded-lg mb-1"
                            style={{
                              border: pickedUserId === c.id ? "2px solid #FFD600" : "1px solid #F3F4F6",
                              background: pickedUserId === c.id ? "#FFFBEB" : "white",
                            }}>
                            <p style={{ fontSize: "14px", fontWeight: 600, color: "#0A0A0A" }}>{c.name}</p>
                            <p style={{ fontSize: "12px", color: "#9CA3AF" }}>
                              {c.email} · {c.role}
                              {!c.hasPassword && " · без пароля"}
                            </p>
                          </button>
                        ))
                    )}
                  </div>

                  {/* Пароль тут опційний: у користувача з сайту він уже є */}
                  {pickedUserId && !candidates.find((c) => c.id === pickedUserId)?.hasPassword && (
                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                        Пароль (у цього користувача його немає)
                      </label>
                      <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="мінімум 6 символів" autoComplete="new-password"
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="rounded-lg p-3 mb-4" style={{ background: "#FFFBEB", border: "1px solid #FDE68A" }}>
                    <p style={{ fontSize: "12px", color: "#92400E", lineHeight: 1.5 }}>
                      Ім'я має збігатися з тим, що в 1С — за ним синхронізація прив'язує продажі.
                      Наприклад «Кавецький Віктор».
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                        Ім'я як у 1С
                      </label>
                      <input value={newName} onChange={(e) => setNewName(e.target.value)}
                        placeholder="Кавецький Віктор"
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                        Email для входу
                      </label>
                      <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)}
                        placeholder="viktor@example.com" autoComplete="off"
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                    </div>
                    <div>
                      <label style={{ display: "block", fontSize: "13px", fontWeight: 600, marginBottom: "6px" }}>
                        Пароль
                      </label>
                      <input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="мінімум 6 символів" autoComplete="new-password"
                        style={{ width: "100%", padding: "10px 14px", borderRadius: "10px", border: "1px solid #E5E7EB", fontSize: "14px" }} />
                    </div>
                  </div>
                </>
              )}

              {addError && (
                <p style={{ fontSize: "13px", color: "#DC2626", fontWeight: 500, marginTop: "12px" }}>{addError}</p>
              )}
            </div>

            <div style={{ padding: "14px 20px", borderTop: "1px solid #EFEFEF" }} className="flex gap-2">
              <button onClick={() => setShowAdd(false)}
                style={{ flex: 1, padding: "10px 16px", borderRadius: "10px", fontWeight: 600, fontSize: "14px", background: "white", color: "#6B7280", border: "1px solid #E5E7EB" }}>
                Скасувати
              </button>
              <button onClick={submitAdd}
                disabled={addSaving || (addMode === "link" ? !pickedUserId : !newName.trim() || !newEmail.trim() || !newPassword)}
                style={{
                  flex: 1, padding: "10px 16px", borderRadius: "10px", fontWeight: 700, fontSize: "14px",
                  background: "#FFD600", color: "#0A0A0A", border: "none",
                  opacity: addSaving || (addMode === "link" ? !pickedUserId : !newName.trim() || !newEmail.trim() || !newPassword) ? 0.4 : 1,
                }}>
                {addSaving ? "Зберігаю..." : addMode === "link" ? "Зробити торговим" : "Створити"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
