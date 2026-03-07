"use client";

import { useSession } from "next-auth/react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { formatPrice, formatDate } from "@/lib/utils";

export default function AdminUsersPage() {
  const { data: session } = useSession();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterRole, setFilterRole] = useState<string>("ALL");

  const role = (session?.user as any)?.role;

  useEffect(() => {
    if (role !== "ADMIN") return;
    fetch("/api/admin/users")
      .then((r) => r.json())
      .then((data) => {
        setUsers(Array.isArray(data) ? data : []);
        setLoading(false);
      });
  }, [role]);

  const promoteToSales = async (userId: string) => {
    if (!confirm("Призначити цього користувача торговим менеджером?")) return;

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "SALES" }),
    });

    if (res.ok) {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: "SALES" } : u))
      );
    }
  };

  const demoteToClient = async (userId: string) => {
    if (!confirm("Зняти роль торгового менеджера?")) return;

    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "CLIENT" }),
    });

    if (res.ok) {
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: "CLIENT" } : u))
      );
    }
  };

  const roleLabels: Record<string, string> = {
    ADMIN: "Адмін",
    SALES: "Торговий",
    CLIENT: "Клієнт",
  };

  const roleColors: Record<string, string> = {
    ADMIN: "bg-red-100 text-red-700",
    SALES: "bg-blue-100 text-blue-700",
    CLIENT: "bg-green-100 text-green-700",
  };

  const filtered = users.filter((u) => {
    const matchesSearch =
      !search ||
      u.name.toLowerCase().includes(search.toLowerCase()) ||
      u.email.toLowerCase().includes(search.toLowerCase()) ||
      (u.phone && u.phone.includes(search));
    const matchesRole = filterRole === "ALL" || u.role === filterRole;
    return matchesSearch && matchesRole;
  });

  if (role !== "ADMIN") {
    return <div className="max-w-7xl mx-auto px-4 py-16 text-center text-red-600 font-bold">Доступ заборонено</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">Користувачі</h1>

      {/* Search and filters */}
      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Пошук за ім'ям, email або телефоном..."
            className="w-full border border-gray-300 rounded-lg px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-orange-500"
          />
        </div>
        <div className="flex gap-2">
          {["ALL", "CLIENT", "SALES", "ADMIN"].map((r) => (
            <button
              key={r}
              onClick={() => setFilterRole(r)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition ${
                filterRole === r
                  ? "bg-gray-900 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              }`}
            >
              {r === "ALL" ? "Усі" : roleLabels[r]} ({r === "ALL" ? users.length : users.filter((u) => u.role === r).length})
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-20 bg-gray-200 rounded"></div>)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border rounded-lg p-12 text-center text-gray-500">
          Користувачів не знайдено
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((user) => (
            <div key={user.id} className="bg-white border rounded-lg p-5 hover:shadow-sm transition">
              <div className="flex flex-col md:flex-row md:items-center gap-4">
                {/* Avatar & Info */}
                <div className="flex items-center gap-4 flex-1">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${
                    user.role === "ADMIN" ? "bg-red-100" : user.role === "SALES" ? "bg-blue-100" : "bg-gray-100"
                  }`}>
                    <span className={`font-bold text-lg ${
                      user.role === "ADMIN" ? "text-red-700" : user.role === "SALES" ? "text-blue-700" : "text-gray-700"
                    }`}>
                      {user.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="font-semibold text-gray-900 hover:text-orange-600 transition"
                    >
                      {user.name}
                    </Link>
                    <p className="text-sm text-gray-500">{user.email}</p>
                    {user.phone && <p className="text-xs text-gray-400">{user.phone}</p>}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <p className="text-xs text-gray-400">Замовлень</p>
                    <p className="font-bold text-gray-900">{user._count.orders}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-400">Витрачено</p>
                    <p className="font-bold text-gray-900">{formatPrice(user.totalSpent)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-gray-400">Болти</p>
                    <p className="font-bold text-orange-600">{user.boltsBalance}</p>
                  </div>
                  <div className="text-center">
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${roleColors[user.role]}`}>
                      {roleLabels[user.role]}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {user.role === "CLIENT" && (
                    <button
                      onClick={() => promoteToSales(user.id)}
                      className="text-blue-600 hover:text-blue-800 border border-blue-200 hover:border-blue-300 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                    >
                      Зробити торговим
                    </button>
                  )}
                  {user.role === "SALES" && (
                    <button
                      onClick={() => demoteToClient(user.id)}
                      className="text-red-600 hover:text-red-800 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                    >
                      Зняти роль
                    </button>
                  )}
                  <Link
                    href={`/admin/users/${user.id}`}
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-xs font-medium transition"
                  >
                    Профіль
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
