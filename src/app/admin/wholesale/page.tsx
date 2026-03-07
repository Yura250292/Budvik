"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

const BUSINESS_TYPE_LABELS: Record<string, string> = {
  PRODUCTION: "Виробництво",
  SHOP: "Магазин",
  SUBDISTRIBUTOR: "Субдистриб'ютор",
  MARKET_POINT: "Точка на ринку",
  OTHER: "Інше",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "На розгляді",
  APPROVED: "Затверджено",
  REJECTED: "Відхилено",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  APPROVED: "bg-green-100 text-green-800",
  REJECTED: "bg-red-100 text-red-800",
};

interface BrandDiscount {
  id: string;
  brand: string;
  discount: number;
}

export default function AdminWholesalePage() {
  const { data: session } = useSession();
  const [tab, setTab] = useState<"applications" | "discounts">("applications");
  const [applications, setApplications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [reviewNote, setReviewNote] = useState<Record<string, string>>({});
  const [processing, setProcessing] = useState<string | null>(null);

  // Brand discounts state
  const [discounts, setDiscounts] = useState<BrandDiscount[]>([]);
  const [discountsLoading, setDiscountsLoading] = useState(true);
  const [newBrand, setNewBrand] = useState("");
  const [newDiscount, setNewDiscount] = useState("");
  const [discountSaving, setDiscountSaving] = useState(false);
  const [discountError, setDiscountError] = useState("");

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN" && role !== "SALES") return;
    fetch("/api/admin/wholesale")
      .then((r) => r.json())
      .then((data) => {
        setApplications(Array.isArray(data) ? data : []);
        setLoading(false);
      });
    fetch("/api/admin/wholesale/discounts")
      .then((r) => r.json())
      .then((data) => {
        setDiscounts(Array.isArray(data) ? data : []);
        setDiscountsLoading(false);
      });
  }, [role]);

  const handleAction = async (id: string, status: "APPROVED" | "REJECTED") => {
    const actionLabel = status === "APPROVED" ? "затвердити" : "відхилити";
    if (!confirm(`Ви впевнені, що хочете ${actionLabel} цю заявку?`)) return;

    setProcessing(id);
    const res = await fetch(`/api/admin/wholesale/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, reviewNote: reviewNote[id] || "" }),
    });

    if (res.ok) {
      const updated = await res.json();
      setApplications((prev) =>
        prev.map((a) => (a.id === id ? updated : a))
      );
    }
    setProcessing(null);
  };

  const handleAddDiscount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDiscountError("");
    const disc = parseFloat(newDiscount);
    if (!newBrand.trim() || isNaN(disc) || disc < 0 || disc > 100) {
      setDiscountError("Введіть назву бренду та знижку від 0 до 100%");
      return;
    }
    setDiscountSaving(true);
    const res = await fetch("/api/admin/wholesale/discounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ brand: newBrand.trim(), discount: disc }),
    });
    const data = await res.json();
    setDiscountSaving(false);
    if (!res.ok) {
      setDiscountError(data.error || "Помилка");
      return;
    }
    setDiscounts((prev) => {
      const idx = prev.findIndex((d) => d.id === data.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = data;
        return copy;
      }
      return [...prev, data].sort((a, b) => a.brand.localeCompare(b.brand));
    });
    setNewBrand("");
    setNewDiscount("");
  };

  const handleDeleteDiscount = async (id: string, brand: string) => {
    if (!confirm(`Видалити знижку для "${brand}"?`)) return;
    const res = await fetch(`/api/admin/wholesale/discounts?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setDiscounts((prev) => prev.filter((d) => d.id !== id));
    }
  };

  const filtered = applications.filter(
    (a) => filterStatus === "ALL" || a.status === filterStatus
  );

  const pendingCount = applications.filter((a) => a.status === "PENDING").length;

  if (role !== "ADMIN" && role !== "SALES") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Оптові продажі</h1>
          {pendingCount > 0 && (
            <p className="text-sm text-yellow-600 mt-1">{pendingCount} заявок очікують розгляду</p>
          )}
        </div>
        <Link
          href="/admin"
          className="text-gray-500 hover:text-gray-700 text-sm"
        >
          &larr; Панель управління
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setTab("applications")}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${
            tab === "applications"
              ? "border-yellow-500 text-yellow-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Заявки оптовиків
          {pendingCount > 0 && (
            <span className="ml-2 bg-yellow-100 text-yellow-700 text-xs px-2 py-0.5 rounded-full">
              {pendingCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("discounts")}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 transition ${
            tab === "discounts"
              ? "border-yellow-500 text-yellow-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
          }`}
        >
          Знижки по брендах
          <span className="ml-2 bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full">
            {discounts.length}
          </span>
        </button>
      </div>

      {/* ========== APPLICATIONS TAB ========== */}
      {tab === "applications" && (
        <>
          {/* Filters */}
          <div className="flex gap-2 mb-6">
            {["ALL", "PENDING", "APPROVED", "REJECTED"].map((s) => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                  filterStatus === s
                    ? "bg-gray-900 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                {s === "ALL" ? "Усі" : STATUS_LABELS[s]}{" "}
                ({s === "ALL" ? applications.length : applications.filter((a) => a.status === s).length})
              </button>
            ))}
          </div>

          {loading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-gray-200 rounded"></div>)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
              Заявок не знайдено
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map((app) => (
                <div key={app.id} className={`bg-white border rounded-xl p-6 ${
                  app.status === "PENDING" ? "border-yellow-200" : ""
                }`}>
                  <div className="flex flex-col lg:flex-row gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-3">
                        <h3 className="font-bold text-gray-900 text-lg">{app.legalName}</h3>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[app.status]}`}>
                          {STATUS_LABELS[app.status]}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-gray-500">ПІБ:</span>{" "}
                          <span className="text-gray-900 font-medium">{app.contactName}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Телефон:</span>{" "}
                          <span className="text-gray-900">{app.phone}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Email:</span>{" "}
                          <span className="text-gray-900">{app.email}</span>
                        </div>
                        <div>
                          <span className="text-gray-500">Вид діяльності:</span>{" "}
                          <span className="text-gray-900">{BUSINESS_TYPE_LABELS[app.businessType]}</span>
                        </div>
                        <div className="md:col-span-2">
                          <span className="text-gray-500">Адреса доставки:</span>{" "}
                          <span className="text-gray-900">{app.address}</span>
                        </div>
                      </div>

                      <div className="mt-3 pt-3 border-t text-sm">
                        <span className="text-gray-500">Користувач:</span>{" "}
                        <Link href={`/admin/users/${app.user.id}`} className="text-yellow-600 hover:underline font-medium">
                          {app.user.name}
                        </Link>
                        <span className="text-gray-400 ml-2">({app.user.email})</span>
                        <span className="text-gray-400 ml-2">&bull; {formatDate(app.createdAt)}</span>
                      </div>

                      {app.reviewNote && (
                        <p className="mt-2 text-sm text-gray-600 bg-gray-50 rounded p-2">
                          <span className="font-medium">Коментар:</span> {app.reviewNote}
                        </p>
                      )}
                    </div>

                    {app.status === "PENDING" && (
                      <div className="flex flex-col gap-2 min-w-[220px]">
                        <textarea
                          value={reviewNote[app.id] || ""}
                          onChange={(e) => setReviewNote({ ...reviewNote, [app.id]: e.target.value })}
                          placeholder="Коментар (необов'язково)"
                          rows={2}
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                        />
                        <button
                          onClick={() => handleAction(app.id, "APPROVED")}
                          disabled={processing === app.id}
                          className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition"
                        >
                          {processing === app.id ? "..." : "Затвердити"}
                        </button>
                        <button
                          onClick={() => handleAction(app.id, "REJECTED")}
                          disabled={processing === app.id}
                          className="bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-100 disabled:opacity-50 transition"
                        >
                          Відхилити
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ========== DISCOUNTS TAB ========== */}
      {tab === "discounts" && (
        <div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-sm text-blue-800">
            Тут ви задаєте знижку у % для кожного бренду. Оптові покупці автоматично бачитимуть ціну зі знижкою
            на товари відповідного бренду. Бренд визначається за назвою товару.
            <br />
            <span className="font-medium">Оптовики не отримують кешбек (Болти).</span> Кешбек доступний лише звичайним покупцям.
          </div>

          {/* Add form */}
          {role === "ADMIN" && (
            <form onSubmit={handleAddDiscount} className="bg-white border rounded-xl p-5 mb-6">
              <h3 className="font-semibold text-gray-900 mb-3">Додати / оновити знижку</h3>
              {discountError && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 mb-3 text-sm">
                  {discountError}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={newBrand}
                  onChange={(e) => setNewBrand(e.target.value)}
                  placeholder="Назва бренду (напр. Einhell, SIGMA, Bosch)"
                  className="flex-1 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500"
                />
                <div className="flex gap-3">
                  <div className="relative">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={newDiscount}
                      onChange={(e) => setNewDiscount(e.target.value)}
                      placeholder="Знижка"
                      className="w-28 border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-500 pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">%</span>
                  </div>
                  <button
                    type="submit"
                    disabled={discountSaving}
                    className="bg-yellow-400 text-black font-semibold px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-yellow-300 disabled:opacity-50 transition whitespace-nowrap"
                  >
                    {discountSaving ? "..." : "Зберегти"}
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">
                Якщо бренд вже існує, знижку буде оновлено
              </p>
            </form>
          )}

          {/* Discounts table */}
          {discountsLoading ? (
            <div className="animate-pulse space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="h-12 bg-gray-200 rounded"></div>)}
            </div>
          ) : discounts.length === 0 ? (
            <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
              Знижок ще не додано
            </div>
          ) : (
            <div className="bg-white border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b">
                    <th className="text-left px-5 py-3 font-medium text-gray-700">Бренд</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-700">Знижка</th>
                    <th className="text-center px-5 py-3 font-medium text-gray-700">Приклад</th>
                    {role === "ADMIN" && (
                      <th className="text-right px-5 py-3 font-medium text-gray-700">Дії</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {discounts.map((d) => (
                    <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td className="px-5 py-3 font-semibold text-gray-900">{d.brand}</td>
                      <td className="px-5 py-3 text-center">
                        <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full font-medium">
                          -{d.discount}%
                        </span>
                      </td>
                      <td className="px-5 py-3 text-center text-gray-500">
                        1000 грн &rarr;{" "}
                        <span className="text-yellow-700 font-medium">
                          {(1000 * (1 - d.discount / 100)).toFixed(0)} грн
                        </span>
                      </td>
                      {role === "ADMIN" && (
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleDeleteDiscount(d.id, d.brand)}
                            className="text-red-500 hover:text-red-700 text-sm font-medium"
                          >
                            Видалити
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
