"use client";

import { useState } from "react";
import Link from "next/link";
import AiMarkdown from "@/components/ai/AiMarkdown";
import { formatPrice } from "@/lib/utils";

interface WizardProduct {
  id: string;
  name: string;
  slug: string;
  description: string;
  price: number;
  image: string | null;
  stock: number;
  isPromo: boolean;
  promoPrice: number | null;
  promoLabel: string | null;
  category: { name: string; slug: string };
}

const TASK_TYPES = [
  { value: "concrete", label: "Бетон / Цегла / Камінь", icon: "🧱" },
  { value: "wood", label: "Дерево / Фанера / ДСП", icon: "🪵" },
  { value: "metal", label: "Метал / Профіль / Труби", icon: "🔩" },
  { value: "tile", label: "Плитка / Кераміка", icon: "🏗" },
  { value: "drywall", label: "Гіпсокартон / Сухі суміші", icon: "🏠" },
  { value: "painting", label: "Фарбування / Оздоблення", icon: "🎨" },
  { value: "measuring", label: "Вимірювання / Розмітка", icon: "📐" },
  { value: "universal", label: "Універсальне використання", icon: "🔧" },
];

const FREQUENCIES = [
  { value: "home", label: "Для дому (рідко)", sub: "Кілька разів на рік" },
  { value: "renovation", label: "Ремонт (помірно)", sub: "Кілька разів на місяць" },
  { value: "professional", label: "Професійне (щоденно)", sub: "Кожен робочий день" },
];

const BUDGETS = [
  { value: "до 1000 грн", label: "До 1000 грн" },
  { value: "1000-3000 грн", label: "1000 - 3000 грн" },
  { value: "3000-6000 грн", label: "3000 - 6000 грн" },
  { value: "6000-10000 грн", label: "6000 - 10000 грн" },
  { value: "більше 10000 грн", label: "Більше 10000 грн" },
];

function ProductComparisonCard({ product, highlights }: { product: WizardProduct; highlights?: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const displayPrice = product.isPromo && product.promoPrice ? product.promoPrice : product.price;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-yellow-400 hover:shadow-lg transition-all flex flex-col">
      {/* Image */}
      <Link href={`/catalog/${product.slug}`} className="block">
        <div className="h-48 bg-gray-50 flex items-center justify-center overflow-hidden">
          {product.image ? (
            <img src={product.image} alt={product.name} className="h-full w-full object-contain p-3 hover:scale-105 transition-transform" />
          ) : (
            <svg className="w-16 h-16 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </div>
      </Link>

      {/* Content */}
      <div className="p-4 flex flex-col flex-1">
        <Link href={`/catalog/${product.slug}`} className="hover:text-yellow-600 transition">
          <h3 className="font-bold text-sm text-gray-900 line-clamp-2 mb-2">{product.name}</h3>
        </Link>

        {/* Price */}
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`text-xl font-bold ${product.isPromo && product.promoPrice ? "text-red-600" : "text-gray-900"}`}>
            {formatPrice(displayPrice)}
          </span>
          {product.isPromo && product.promoPrice && product.promoPrice < product.price && (
            <span className="text-sm text-gray-400 line-through">{formatPrice(product.price)}</span>
          )}
        </div>

        {/* Stock */}
        <div className="mb-3">
          {product.stock > 0 ? (
            <span className="inline-flex items-center gap-1 text-green-600 text-xs font-medium">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              В наявності ({product.stock} шт)
            </span>
          ) : (
            <span className="text-red-500 text-xs font-medium">Немає в наявності</span>
          )}
        </div>

        {/* Description */}
        {product.description && (
          <div className="mb-3">
            <p className={`text-xs text-gray-500 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
              {product.description}
            </p>
            {product.description.length > 100 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-xs text-yellow-600 hover:text-yellow-700 mt-1 font-medium"
              >
                {expanded ? "Згорнути" : "Детальніше..."}
              </button>
            )}
          </div>
        )}

        {/* Highlights */}
        {highlights && highlights.length > 0 && (
          <ul className="space-y-1 mb-3">
            {highlights.map((h, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-gray-600">
                <span className="text-yellow-500 mt-0.5 flex-shrink-0">+</span>
                {h}
              </li>
            ))}
          </ul>
        )}

        {/* Link */}
        <div className="mt-auto pt-2">
          <Link
            href={`/catalog/${product.slug}`}
            className="block w-full text-center bg-yellow-400 hover:bg-yellow-300 text-black py-2 rounded-lg text-sm font-semibold transition"
          >
            Переглянути товар
          </Link>
        </div>
      </div>
    </div>
  );
}

function ComparisonTable({ products }: { products: WizardProduct[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="border border-gray-200 bg-gray-50 px-4 py-3 text-left font-semibold text-gray-600 w-32">Параметр</th>
            {products.map((p) => (
              <th key={p.id} className="border border-gray-200 bg-yellow-50 px-4 py-3 text-center font-semibold text-gray-800">
                <Link href={`/catalog/${p.slug}`} className="hover:text-yellow-600 transition">
                  {p.name.length > 30 ? p.name.slice(0, 30) + "..." : p.name}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-gray-200 px-4 py-3 font-medium text-gray-600">Фото</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3 text-center">
                <Link href={`/catalog/${p.slug}`} className="inline-block">
                  {p.image ? (
                    <img src={p.image} alt={p.name} className="w-20 h-20 object-contain rounded mx-auto hover:scale-110 transition-transform" />
                  ) : (
                    <div className="w-20 h-20 bg-gray-100 rounded flex items-center justify-center text-gray-300 mx-auto">
                      <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                  )}
                </Link>
              </td>
            ))}
          </tr>
          <tr className="bg-gray-50">
            <td className="border border-gray-200 px-4 py-3 font-medium text-gray-600">Ціна</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3 text-center">
                {p.isPromo && p.promoPrice ? (
                  <div>
                    <span className="text-lg font-bold text-red-600">{formatPrice(p.promoPrice)}</span>
                    <br />
                    <span className="text-xs text-gray-400 line-through">{formatPrice(p.price)}</span>
                  </div>
                ) : (
                  <span className="text-lg font-bold text-gray-900">{formatPrice(p.price)}</span>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-gray-200 px-4 py-3 font-medium text-gray-600">Категорія</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3 text-center text-gray-700">
                {/^\d+$/.test(p.category.name) ? "" : p.category.name}
              </td>
            ))}
          </tr>
          <tr className="bg-gray-50">
            <td className="border border-gray-200 px-4 py-3 font-medium text-gray-600">Наявність</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3 text-center">
                {p.stock > 0 ? (
                  <span className="text-green-600 font-medium">{p.stock} шт</span>
                ) : (
                  <span className="text-red-500 font-medium">Немає</span>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-gray-200 px-4 py-3 font-medium text-gray-600">Опис</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3 text-xs text-gray-600 leading-relaxed">
                {p.description ? p.description.slice(0, 120) + (p.description.length > 120 ? "..." : "") : "—"}
              </td>
            ))}
          </tr>
          <tr className="bg-yellow-50">
            <td className="border border-gray-200 px-4 py-3 font-medium text-gray-600">Дія</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3 text-center">
                <Link
                  href={`/catalog/${p.slug}`}
                  className="inline-block bg-yellow-400 hover:bg-yellow-300 text-black px-4 py-2 rounded-lg text-sm font-semibold transition"
                >
                  Перейти
                </Link>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function WizardPage() {
  const [step, setStep] = useState(1);
  const [taskType, setTaskType] = useState("");
  const [frequency, setFrequency] = useState("");
  const [budget, setBudget] = useState("");
  const [result, setResult] = useState("");
  const [products, setProducts] = useState<WizardProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskType: TASK_TYPES.find((t) => t.value === taskType)?.label || taskType,
          frequency: FREQUENCIES.find((f) => f.value === frequency)?.label || frequency,
          budget,
        }),
      });
      const data = await res.json();
      setResult(data.response || data.error || "Помилка");
      setProducts(data.products || []);
      setStep(4);
    } catch {
      setResult("Помилка з'єднання з AI");
      setStep(4);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(1);
    setTaskType("");
    setFrequency("");
    setBudget("");
    setResult("");
    setProducts([]);
    setShowComparison(false);
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Підбір інструментів</h1>
      <p className="text-gray-500 mb-8">Відповідайте на питання, і AI підбере найкращі інструменти для вас</p>

      {/* Progress */}
      {step <= 3 && (
        <div className="flex items-center mb-8">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center flex-1">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                step >= s ? "bg-yellow-400 text-black" : "bg-gray-200 text-gray-500"
              }`}>
                {step > s ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  s
                )}
              </div>
              {s < 3 && <div className={`flex-1 h-1 mx-2 rounded ${step > s ? "bg-yellow-400" : "bg-gray-200"}`} />}
            </div>
          ))}
        </div>
      )}

      {/* Step 1: Task Type */}
      {step === 1 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Який тип роботи?</h2>
          <div className="grid grid-cols-2 gap-3">
            {TASK_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => { setTaskType(t.value); setStep(2); }}
                className={`p-4 rounded-lg border-2 text-left transition flex items-center gap-3 ${
                  taskType === t.value
                    ? "border-yellow-400 bg-yellow-50"
                    : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="text-2xl">{t.icon}</span>
                <span className="font-medium text-gray-900">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Frequency */}
      {step === 2 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Як часто будете використовувати?</h2>
          <div className="grid grid-cols-1 gap-3">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                onClick={() => { setFrequency(f.value); setStep(3); }}
                className={`p-4 rounded-lg border-2 text-left transition ${
                  frequency === f.value
                    ? "border-yellow-400 bg-yellow-50"
                    : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="font-medium text-gray-900">{f.label}</span>
                <span className="block text-sm text-gray-500 mt-0.5">{f.sub}</span>
              </button>
            ))}
          </div>
          <button onClick={() => setStep(1)} className="mt-4 text-gray-500 hover:text-gray-700">
            ← Назад
          </button>
        </div>
      )}

      {/* Step 3: Budget */}
      {step === 3 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Ваш бюджет?</h2>
          <div className="grid grid-cols-1 gap-3">
            {BUDGETS.map((b) => (
              <button
                key={b.value}
                onClick={() => { setBudget(b.value); }}
                className={`p-4 rounded-lg border-2 text-left transition ${
                  budget === b.value
                    ? "border-yellow-400 bg-yellow-50"
                    : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="font-medium text-gray-900">{b.label}</span>
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(2)} className="text-gray-500 hover:text-gray-700">
              ← Назад
            </button>
            <button
              onClick={handleSubmit}
              disabled={!budget || loading}
              className="bg-yellow-400 text-black px-8 py-3 rounded-lg hover:bg-yellow-300 disabled:opacity-50 font-semibold transition"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-black border-t-transparent rounded-full" />
                  AI підбирає...
                </span>
              ) : (
                "Підібрати інструменти"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && step === 3 && (
        <div className="mt-8 text-center">
          <div className="animate-spin w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">AI аналізує каталог та підбирає найкращі варіанти...</p>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Результати AI підбору</h2>

          {/* Product cards grid */}
          {products.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  Рекомендовані товари ({products.length})
                </h3>
                {products.length >= 2 && (
                  <button
                    onClick={() => setShowComparison(!showComparison)}
                    className="text-sm text-yellow-700 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-lg px-4 py-2 font-medium transition"
                  >
                    {showComparison ? "Сховати порівняння" : "Порівняти товари"}
                  </button>
                )}
              </div>

              {/* Product cards */}
              <div className={`grid gap-4 ${products.length === 1 ? "grid-cols-1 max-w-sm" : products.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
                {products.map((product) => (
                  <ProductComparisonCard key={product.id} product={product} />
                ))}
              </div>

              {/* Comparison table */}
              {showComparison && products.length >= 2 && (
                <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Порівняння товарів</h3>
                  <ComparisonTable products={products} />
                </div>
              )}
            </div>
          )}

          {/* AI text analysis */}
          <div className="bg-white border border-gray-200 rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-yellow-600 rounded-lg flex items-center justify-center">
                <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3" />
                </svg>
              </div>
              <h3 className="font-semibold text-gray-800">Аналіз AI</h3>
            </div>
            <AiMarkdown content={result} />
          </div>

          <button
            onClick={reset}
            className="mt-6 bg-yellow-400 text-black px-6 py-3 rounded-lg hover:bg-yellow-300 font-semibold transition"
          >
            Підібрати ще раз
          </button>
        </div>
      )}
    </div>
  );
}
