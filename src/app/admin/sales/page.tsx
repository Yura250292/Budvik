"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

export default function AdminSalesPage() {
  const { data: session } = useSession();
  const [salesUsers, setSalesUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN") return;
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        setSalesUsers(Array.isArray(data) ? data.filter((u: any) => u.role === "SALES") : []);
        setLoading(false);
      });
  }, [role]);

  const demoteToClient = async (userId: string) => {
    if (!confirm("Зняти роль торгового менеджера з цього користувача?")) return;

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "CLIENT" }),
    });

    if (res.ok) {
      setSalesUsers((prev) => prev.filter((u) => u.id !== userId));
    }
  };

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-bk">Торгові менеджери</h1>
          <p className="text-g400 mt-1">Користувачі з роллю &quot;Торговий&quot; можуть переглядати та оновлювати статуси замовлень</p>
        </div>
        <Link
          href="/admin/users"
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-500 transition text-sm"
        >
          + Призначити торгового
        </Link>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-20 bg-g200 rounded"></div>)}
        </div>
      ) : salesUsers.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mx-auto text-g300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <p className="text-g400 text-lg mb-2">Торгових менеджерів поки немає</p>
          <p className="text-g400 text-sm mb-4">
            Перейдіть до списку клієнтів, щоб призначити торгового менеджера
          </p>
          <Link
            href="/admin/users"
            className="inline-block bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-500 transition"
          >
            Перейти до клієнтів
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {salesUsers.map((user) => (
            <div key={user.id} className="bg-white border rounded-lg p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-700 font-bold text-lg">{user.name.charAt(0).toUpperCase()}</span>
                </div>
                <div>
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="font-semibold text-bk hover:text-primary transition"
                  >
                    {user.name}
                  </Link>
                  <p className="text-sm text-g400">{user.email}</p>
                  {user.phone && <p className="text-sm text-g400">{user.phone}</p>}
                </div>
              </div>
              <div className="flex items-center gap-6">
                <div className="text-center">
                  <p className="text-sm text-g400">Зареєстрований</p>
                  <p className="font-medium text-g600 text-sm">{formatDate(user.createdAt)}</p>
                </div>
                <button
                  onClick={() => demoteToClient(user.id)}
                  className="text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  Зняти роль
                </button>
                <Link
                  href={`/admin/users/${user.id}`}
                  className="bg-g100 hover:bg-g200 text-g600 px-4 py-2 rounded-lg text-sm font-medium transition"
                >
                  Профіль
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
