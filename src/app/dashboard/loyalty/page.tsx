"use client";

import { useEffect, useState } from "react";
import { formatDate, formatPrice } from "@/lib/utils";

export default function LoyaltyPage() {
  const [data, setData] = useState<{ balance: number; transactions: any[] }>({ balance: 0, transactions: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/user/bolts")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-64 mb-4"></div>
        <div className="h-40 bg-gray-200 rounded mb-4"></div>
        <div className="h-64 bg-gray-200 rounded"></div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Програма лояльності &quot;Болти&quot;</h1>

      {/* Balance Card */}
      <div className="bg-gradient-to-r from-orange-500 to-orange-600 rounded-xl p-8 text-white mb-8">
        <p className="text-lg opacity-80 mb-1">Ваш баланс</p>
        <p className="text-5xl font-bold mb-2">{data.balance} Болтів</p>
        <p className="opacity-80">= {formatPrice(data.balance)}</p>
      </div>

      {/* Rules */}
      <div className="bg-white border rounded-lg p-6 mb-8">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Як працюють Болти?</h2>
        <div className="grid md:grid-cols-3 gap-4">
          <div className="text-center p-4">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-xl">1</span>
            </div>
            <h3 className="font-semibold mb-1">Купуйте</h3>
            <p className="text-sm text-gray-500">Робіть покупки у нашому магазині</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-xl">2</span>
            </div>
            <h3 className="font-semibold mb-1">Отримуйте 5%</h3>
            <p className="text-sm text-gray-500">Кешбек нараховується при доставці</p>
          </div>
          <div className="text-center p-4">
            <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <span className="text-xl">3</span>
            </div>
            <h3 className="font-semibold mb-1">Економте до 30%</h3>
            <p className="text-sm text-gray-500">Оплачуйте Болтами частину замовлення</p>
          </div>
        </div>
      </div>

      {/* Transaction History */}
      <div className="bg-white border rounded-lg">
        <div className="p-4 border-b">
          <h2 className="text-xl font-bold text-gray-900">Історія транзакцій</h2>
        </div>
        {data.transactions.length === 0 ? (
          <p className="p-8 text-center text-gray-500">Поки немає транзакцій</p>
        ) : (
          <div className="divide-y">
            {data.transactions.map((tx: any) => (
              <div key={tx.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900">{tx.description}</p>
                  <p className="text-sm text-gray-500">{formatDate(tx.createdAt)}</p>
                </div>
                <span className={`font-bold text-lg ${tx.type === "EARNED" ? "text-green-600" : "text-red-500"}`}>
                  {tx.type === "EARNED" ? "+" : ""}{tx.amount} Болтів
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
