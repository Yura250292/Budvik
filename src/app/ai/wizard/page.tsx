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
  pros?: string[];
  cons?: string[];
}

// Step 1: What category of tool
const TOOL_CATEGORIES = [
  { value: "drilling", label: "Свердління / Перфорація", icon: "🔩", tools: "Дрилі, перфоратори, шуруповерти" },
  { value: "cutting", label: "Різання / Розпил", icon: "🪚", tools: "Болгарки, пили, лобзики" },
  { value: "grinding", label: "Шліфування / Полірування", icon: "✨", tools: "Шліфмашини, полірувальні машини" },
  { value: "measuring", label: "Вимірювання / Розмітка", icon: "📐", tools: "Рівні, рулетки, далекоміри" },
  { value: "welding", label: "Зварювання / Паяння", icon: "⚡", tools: "Зварювальні апарати, паяльники" },
  { value: "painting", label: "Фарбування / Оздоблення", icon: "🎨", tools: "Фарбопульти, валики, шпателі" },
  { value: "hand_tools", label: "Ручний інструмент", icon: "🔧", tools: "Ключі, набори, викрутки" },
  { value: "other", label: "Інше / Не знаю", icon: "❓", tools: "Допоможу визначитись" },
];

// Step 2: What material (depends on category)
const MATERIALS: Record<string, { value: string; label: string }[]> = {
  drilling: [
    { value: "concrete", label: "Бетон / Цегла / Камінь" },
    { value: "wood", label: "Дерево / Фанера / ДСП" },
    { value: "metal", label: "Метал" },
    { value: "drywall", label: "Гіпсокартон / Сухі суміші" },
    { value: "mixed", label: "Різні матеріали" },
  ],
  cutting: [
    { value: "wood", label: "Дерево / Фанера / ДСП" },
    { value: "metal", label: "Метал / Профіль / Труби" },
    { value: "concrete", label: "Бетон / Камінь / Плитка" },
    { value: "mixed", label: "Різні матеріали" },
  ],
  grinding: [
    { value: "wood", label: "Дерево" },
    { value: "metal", label: "Метал" },
    { value: "concrete", label: "Бетон / Камінь" },
    { value: "paint", label: "Фарба / Лак / Покриття" },
  ],
  welding: [
    { value: "thin_metal", label: "Тонкий метал (до 3 мм)" },
    { value: "thick_metal", label: "Товстий метал (3+ мм)" },
    { value: "pipes", label: "Труби / Профілі" },
    { value: "auto", label: "Автомобільні роботи" },
  ],
};

// Step 3: Specific tasks (depends on category + material)
const SPECIFIC_TASKS: Record<string, { value: string; label: string }[]> = {
  "drilling:concrete": [
    { value: "small_holes", label: "Невеликі отвори (до 16 мм) — дюбелі, кріплення" },
    { value: "large_holes", label: "Великі отвори (16+ мм) — коронки, підрозетники" },
    { value: "demolition", label: "Довбання / демонтаж" },
    { value: "anchors", label: "Анкера / хімічні болти" },
  ],
  "drilling:wood": [
    { value: "assembly", label: "Збірка меблів / кріплення" },
    { value: "holes", label: "Свердління отворів" },
    { value: "screwing", label: "Закручування шурупів / саморізів" },
  ],
  "drilling:metal": [
    { value: "thin", label: "Тонкий метал (листи, профілі)" },
    { value: "thick", label: "Товстий метал (конструкції)" },
    { value: "precision", label: "Точні отвори" },
  ],
  "cutting:wood": [
    { value: "straight", label: "Прямий розпил дошок / брусів" },
    { value: "curved", label: "Фігурний / криволінійний різ" },
    { value: "trim", label: "Підрізка / торцювання" },
    { value: "logs", label: "Розпил колод / великих заготовок" },
  ],
  "cutting:metal": [
    { value: "sheets", label: "Листовий метал / профнастил" },
    { value: "rebar", label: "Арматура / прутки" },
    { value: "pipes", label: "Труби" },
    { value: "precise", label: "Точний рівний різ" },
  ],
};

// Step 4: Frequency
const FREQUENCIES = [
  { value: "rare", label: "Рідко — кілька разів на рік", sub: "Для дому, дрібні роботи" },
  { value: "moderate", label: "Помірно — кілька разів на місяць", sub: "Ремонт, хобі, дача" },
  { value: "frequent", label: "Часто — кілька разів на тиждень", sub: "Серйозні проекти" },
  { value: "daily", label: "Щоденно — професійне використання", sub: "На роботі, на об'єктах" },
];

// Step 5: Power source
const POWER_SOURCES = [
  { value: "corded", label: "Мережевий (220В)", sub: "Більша потужність, без обмежень по заряду" },
  { value: "cordless", label: "Акумуляторний", sub: "Мобільність, зручність, без проводів" },
  { value: "any", label: "Не має значення", sub: "Покажіть обидва варіанти" },
];

// Step 6: Brand preference
const BRAND_PREFERENCES = [
  { value: "bosch", label: "Bosch" },
  { value: "makita", label: "Makita" },
  { value: "dewalt", label: "DeWalt" },
  { value: "milwaukee", label: "Milwaukee" },
  { value: "yato", label: "YATO" },
  { value: "sigma", label: "SIGMA" },
  { value: "dnipro-m", label: "Dnipro-M" },
  { value: "any", label: "Без переваг — покажіть найкращі" },
];

// Step 7: Budget
const BUDGETS = [
  { value: "до 1000 грн", label: "До 1000 грн", sub: "Базовий" },
  { value: "1000-2500 грн", label: "1000 - 2500 грн", sub: "Середній" },
  { value: "2500-5000 грн", label: "2500 - 5000 грн", sub: "Хороший" },
  { value: "5000-10000 грн", label: "5000 - 10 000 грн", sub: "Преміум" },
  { value: "більше 10000 грн", label: "Більше 10 000 грн", sub: "Професійний" },
];

// Step 8: Additional requirements
const ADDITIONAL_FEATURES = [
  { value: "lightweight", label: "Легкий / компактний" },
  { value: "powerful", label: "Максимальна потужність" },
  { value: "quiet", label: "Тихий в роботі" },
  { value: "warranty", label: "Тривала гарантія" },
  { value: "accessories", label: "Багатий комплект (кейс, насадки)" },
  { value: "ergonomic", label: "Зручний хват / ергономіка" },
  { value: "dust", label: "Пиловідведення" },
  { value: "none", label: "Без особливих вимог" },
];

function ProductComparisonCard({ product }: { product: WizardProduct }) {
  const [expanded, setExpanded] = useState(false);
  const displayPrice = product.isPromo && product.promoPrice ? product.promoPrice : product.price;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:border-yellow-400 hover:shadow-lg transition-all flex flex-col">
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
      <div className="p-4 flex flex-col flex-1">
        <Link href={`/catalog/${product.slug}`} className="hover:text-yellow-600 transition">
          <h3 className="font-bold text-sm text-gray-900 line-clamp-2 mb-2">{product.name}</h3>
        </Link>
        <div className="flex items-baseline gap-2 mb-2">
          <span className={`text-xl font-bold ${product.isPromo && product.promoPrice ? "text-red-600" : "text-gray-900"}`}>
            {formatPrice(displayPrice)}
          </span>
          {product.isPromo && product.promoPrice && product.promoPrice < product.price && (
            <span className="text-sm text-gray-400 line-through">{formatPrice(product.price)}</span>
          )}
        </div>
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
        {product.description && (
          <div className="mb-3">
            <p className={`text-xs text-gray-500 leading-relaxed ${expanded ? "" : "line-clamp-2"}`}>
              {product.description}
            </p>
            {product.description.length > 100 && (
              <button onClick={() => setExpanded(!expanded)} className="text-xs text-yellow-600 hover:text-yellow-700 mt-1 font-medium">
                {expanded ? "Згорнути" : "Детальніше..."}
              </button>
            )}
          </div>
        )}
        {/* Pros */}
        {product.pros && product.pros.length > 0 && (
          <div className="mb-2">
            {product.pros.map((p, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-green-700 mb-0.5">
                <span className="flex-shrink-0 mt-0.5">+</span>
                <span>{p}</span>
              </div>
            ))}
          </div>
        )}
        {/* Cons */}
        {product.cons && product.cons.length > 0 && (
          <div className="mb-2">
            {product.cons.map((c, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs text-red-500 mb-0.5">
                <span className="flex-shrink-0 mt-0.5">−</span>
                <span>{c}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-auto pt-2">
          <Link href={`/catalog/${product.slug}`} className="block w-full text-center bg-yellow-400 hover:bg-yellow-300 text-black py-2 rounded-lg text-sm font-semibold transition">
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
                    <div className="w-20 h-20 bg-gray-100 rounded flex items-center justify-center text-gray-300 mx-auto">Фото</div>
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
                  <div><span className="text-lg font-bold text-red-600">{formatPrice(p.promoPrice)}</span><br /><span className="text-xs text-gray-400 line-through">{formatPrice(p.price)}</span></div>
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
                {p.stock > 0 ? <span className="text-green-600 font-medium">{p.stock} шт</span> : <span className="text-red-500 font-medium">Немає</span>}
              </td>
            ))}
          </tr>
          <tr>
            <td className="border border-gray-200 px-4 py-3 font-medium text-green-700">Переваги</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3">
                {p.pros && p.pros.length > 0 ? (
                  <ul className="space-y-1">
                    {p.pros.map((pro, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-green-700">
                        <span className="flex-shrink-0 font-bold">+</span>
                        <span>{pro}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
                )}
              </td>
            ))}
          </tr>
          <tr className="bg-red-50/30">
            <td className="border border-gray-200 px-4 py-3 font-medium text-red-600">Недоліки</td>
            {products.map((p) => (
              <td key={p.id} className="border border-gray-200 px-4 py-3">
                {p.cons && p.cons.length > 0 ? (
                  <ul className="space-y-1">
                    {p.cons.map((con, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-xs text-red-600">
                        <span className="flex-shrink-0 font-bold">−</span>
                        <span>{con}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-gray-400">—</span>
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
                <Link href={`/catalog/${p.slug}`} className="inline-block bg-yellow-400 hover:bg-yellow-300 text-black px-4 py-2 rounded-lg text-sm font-semibold transition">
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

const TOTAL_STEPS = 7;

export default function WizardPage() {
  const [step, setStep] = useState(1);
  const [toolCategory, setToolCategory] = useState("");
  const [material, setMaterial] = useState("");
  const [specificTask, setSpecificTask] = useState("");
  const [frequency, setFrequency] = useState("");
  const [powerSource, setPowerSource] = useState("");
  const [brandPref, setBrandPref] = useState("");
  const [budget, setBudget] = useState("");
  const [additionalFeatures, setAdditionalFeatures] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [products, setProducts] = useState<WizardProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // Determine which steps to show based on category
  const hasMaterialStep = !!MATERIALS[toolCategory];
  const hasTaskStep = !!SPECIFIC_TASKS[`${toolCategory}:${material}`];
  const hasPowerStep = ["drilling", "cutting", "grinding"].includes(toolCategory);

  // Calculate actual step mapping
  const getStepContent = (currentStep: number) => {
    const steps: string[] = ["category"];
    if (hasMaterialStep) steps.push("material");
    if (hasTaskStep) steps.push("task");
    steps.push("frequency");
    if (hasPowerStep) steps.push("power");
    steps.push("brand", "budget", "features");
    return steps[currentStep - 1] || "category";
  };

  const getTotalSteps = () => {
    let count = 4; // category + frequency + brand + budget + features
    if (hasMaterialStep) count++;
    if (hasTaskStep) count++;
    if (hasPowerStep) count++;
    return count + 1; // +1 for features
  };

  const currentContent = getStepContent(step);
  const totalSteps = getTotalSteps();

  const goNext = () => setStep((s) => s + 1);
  const goBack = () => setStep((s) => Math.max(1, s - 1));

  const handleCategorySelect = (value: string) => {
    setToolCategory(value);
    setMaterial("");
    setSpecificTask("");
    setPowerSource("");
    goNext();
  };

  const handleSubmit = async () => {
    setLoading(true);
    try {
      const categoryLabel = TOOL_CATEGORIES.find((t) => t.value === toolCategory)?.label || toolCategory;
      const materialLabel = MATERIALS[toolCategory]?.find((m) => m.value === material)?.label || material;
      const taskLabel = SPECIFIC_TASKS[`${toolCategory}:${material}`]?.find((t) => t.value === specificTask)?.label || specificTask;
      const frequencyLabel = FREQUENCIES.find((f) => f.value === frequency)?.label || frequency;
      const powerLabel = POWER_SOURCES.find((p) => p.value === powerSource)?.label || powerSource;
      const brandLabel = BRAND_PREFERENCES.find((b) => b.value === brandPref)?.label || brandPref;
      const featuresLabels = additionalFeatures
        .filter((f) => f !== "none")
        .map((f) => ADDITIONAL_FEATURES.find((af) => af.value === f)?.label || f);

      const res = await fetch("/api/ai/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolCategory: categoryLabel,
          material: materialLabel,
          specificTask: taskLabel,
          frequency: frequencyLabel,
          powerSource: powerLabel,
          brand: brandLabel,
          budget,
          additionalFeatures: featuresLabels.join(", "),
        }),
      });
      const data = await res.json();
      setResult(data.response || data.error || "Помилка");
      setProducts(data.products || []);
      setStep(99); // results
    } catch {
      setResult("Помилка з'єднання з AI");
      setStep(99);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStep(1);
    setToolCategory("");
    setMaterial("");
    setSpecificTask("");
    setFrequency("");
    setPowerSource("");
    setBrandPref("");
    setBudget("");
    setAdditionalFeatures([]);
    setResult("");
    setProducts([]);
    setShowComparison(false);
  };

  const toggleFeature = (value: string) => {
    if (value === "none") {
      setAdditionalFeatures(["none"]);
      return;
    }
    setAdditionalFeatures((prev) => {
      const filtered = prev.filter((f) => f !== "none");
      return filtered.includes(value) ? filtered.filter((f) => f !== value) : [...filtered, value];
    });
  };

  // Summary of selections so far
  const renderSummary = () => {
    const items: { label: string; value: string }[] = [];
    if (toolCategory) items.push({ label: "Категорія", value: TOOL_CATEGORIES.find((t) => t.value === toolCategory)?.label || "" });
    if (material) items.push({ label: "Матеріал", value: MATERIALS[toolCategory]?.find((m) => m.value === material)?.label || "" });
    if (specificTask) items.push({ label: "Задача", value: SPECIFIC_TASKS[`${toolCategory}:${material}`]?.find((t) => t.value === specificTask)?.label || "" });
    if (frequency) items.push({ label: "Частота", value: FREQUENCIES.find((f) => f.value === frequency)?.label || "" });
    if (powerSource && hasPowerStep) items.push({ label: "Живлення", value: POWER_SOURCES.find((p) => p.value === powerSource)?.label || "" });
    if (brandPref) items.push({ label: "Бренд", value: BRAND_PREFERENCES.find((b) => b.value === brandPref)?.label || "" });
    if (budget) items.push({ label: "Бюджет", value: budget });

    if (items.length === 0) return null;

    return (
      <div className="mb-6 bg-gray-50 rounded-lg p-3 flex flex-wrap gap-2">
        {items.map((item) => (
          <span key={item.label} className="text-xs bg-white border border-gray-200 rounded-full px-3 py-1 text-gray-600">
            <span className="font-medium text-gray-800">{item.label}:</span> {item.value}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Підбір інструментів</h1>
      <p className="text-gray-500 mb-6">Відповідайте на питання — AI підбере найкращий інструмент саме для вас</p>

      {/* Progress bar */}
      {step < 99 && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-400 mb-1">
            <span>Крок {Math.min(step, totalSteps)} з {totalSteps}</span>
            <span>{Math.round((Math.min(step, totalSteps) / totalSteps) * 100)}%</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-400 rounded-full transition-all duration-300"
              style={{ width: `${(Math.min(step, totalSteps) / totalSteps) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Summary */}
      {step > 1 && step < 99 && renderSummary()}

      {/* Step: Tool Category */}
      {currentContent === "category" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Що шукаєте?</h2>
          <p className="text-sm text-gray-500 mb-4">Оберіть тип інструменту</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {TOOL_CATEGORIES.map((t) => (
              <button
                key={t.value}
                onClick={() => handleCategorySelect(t.value)}
                className="p-4 rounded-xl border-2 text-left transition flex items-start gap-3 border-gray-200 hover:border-yellow-400 hover:bg-yellow-50"
              >
                <span className="text-2xl mt-0.5">{t.icon}</span>
                <div>
                  <span className="font-semibold text-gray-900 block">{t.label}</span>
                  <span className="text-xs text-gray-500">{t.tools}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step: Material */}
      {currentContent === "material" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">З яким матеріалом працюєте?</h2>
          <p className="text-sm text-gray-500 mb-4">Це допоможе підібрати правильний тип</p>
          <div className="grid grid-cols-1 gap-3">
            {(MATERIALS[toolCategory] || []).map((m) => (
              <button
                key={m.value}
                onClick={() => { setMaterial(m.value); setSpecificTask(""); goNext(); }}
                className={`p-4 rounded-xl border-2 text-left transition font-medium ${
                  material === m.value ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button onClick={goBack} className="mt-4 text-sm text-gray-500 hover:text-gray-700">← Назад</button>
        </div>
      )}

      {/* Step: Specific Task */}
      {currentContent === "task" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Яка конкретна задача?</h2>
          <p className="text-sm text-gray-500 mb-4">Уточніть, що саме будете робити</p>
          <div className="grid grid-cols-1 gap-3">
            {(SPECIFIC_TASKS[`${toolCategory}:${material}`] || []).map((t) => (
              <button
                key={t.value}
                onClick={() => { setSpecificTask(t.value); goNext(); }}
                className={`p-4 rounded-xl border-2 text-left transition ${
                  specificTask === t.value ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="font-medium text-gray-900">{t.label}</span>
              </button>
            ))}
          </div>
          <button onClick={goBack} className="mt-4 text-sm text-gray-500 hover:text-gray-700">← Назад</button>
        </div>
      )}

      {/* Step: Frequency */}
      {currentContent === "frequency" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Як часто будете використовувати?</h2>
          <p className="text-sm text-gray-500 mb-4">Від цього залежить клас інструменту</p>
          <div className="grid grid-cols-1 gap-3">
            {FREQUENCIES.map((f) => (
              <button
                key={f.value}
                onClick={() => { setFrequency(f.value); goNext(); }}
                className={`p-4 rounded-xl border-2 text-left transition ${
                  frequency === f.value ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="font-semibold text-gray-900">{f.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{f.sub}</span>
              </button>
            ))}
          </div>
          <button onClick={goBack} className="mt-4 text-sm text-gray-500 hover:text-gray-700">← Назад</button>
        </div>
      )}

      {/* Step: Power Source */}
      {currentContent === "power" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Мережевий чи акумуляторний?</h2>
          <p className="text-sm text-gray-500 mb-4">Тип живлення інструменту</p>
          <div className="grid grid-cols-1 gap-3">
            {POWER_SOURCES.map((p) => (
              <button
                key={p.value}
                onClick={() => { setPowerSource(p.value); goNext(); }}
                className={`p-4 rounded-xl border-2 text-left transition ${
                  powerSource === p.value ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="font-semibold text-gray-900">{p.label}</span>
                <span className="block text-xs text-gray-500 mt-0.5">{p.sub}</span>
              </button>
            ))}
          </div>
          <button onClick={goBack} className="mt-4 text-sm text-gray-500 hover:text-gray-700">← Назад</button>
        </div>
      )}

      {/* Step: Brand */}
      {currentContent === "brand" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Переваги по бренду?</h2>
          <p className="text-sm text-gray-500 mb-4">Чи є улюблений виробник?</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {BRAND_PREFERENCES.map((b) => (
              <button
                key={b.value}
                onClick={() => { setBrandPref(b.value); goNext(); }}
                className={`p-4 rounded-xl border-2 text-center transition font-medium ${
                  brandPref === b.value ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                } ${b.value === "any" ? "col-span-2 sm:col-span-4" : ""}`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <button onClick={goBack} className="mt-4 text-sm text-gray-500 hover:text-gray-700">← Назад</button>
        </div>
      )}

      {/* Step: Budget */}
      {currentContent === "budget" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Ваш бюджет?</h2>
          <p className="text-sm text-gray-500 mb-4">Скільки готові витратити</p>
          <div className="grid grid-cols-1 gap-3">
            {BUDGETS.map((b) => (
              <button
                key={b.value}
                onClick={() => { setBudget(b.value); goNext(); }}
                className={`p-4 rounded-xl border-2 text-left transition flex justify-between items-center ${
                  budget === b.value ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                }`}
              >
                <span className="font-semibold text-gray-900">{b.label}</span>
                <span className="text-xs text-gray-400">{b.sub}</span>
              </button>
            ))}
          </div>
          <button onClick={goBack} className="mt-4 text-sm text-gray-500 hover:text-gray-700">← Назад</button>
        </div>
      )}

      {/* Step: Additional Features */}
      {currentContent === "features" && step < 99 && (
        <div>
          <h2 className="text-xl font-semibold mb-1">Додаткові вимоги?</h2>
          <p className="text-sm text-gray-500 mb-4">Оберіть що важливо (можна кілька)</p>
          <div className="grid grid-cols-2 gap-3">
            {ADDITIONAL_FEATURES.map((f) => (
              <button
                key={f.value}
                onClick={() => toggleFeature(f.value)}
                className={`p-4 rounded-xl border-2 text-left transition font-medium ${
                  additionalFeatures.includes(f.value) ? "border-yellow-400 bg-yellow-50" : "border-gray-200 hover:border-yellow-300"
                } ${f.value === "none" ? "col-span-2" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-between">
            <button onClick={goBack} className="text-sm text-gray-500 hover:text-gray-700">← Назад</button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="bg-yellow-400 text-black px-8 py-3 rounded-xl hover:bg-yellow-300 disabled:opacity-50 font-semibold transition"
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

      {/* Loading overlay */}
      {loading && (
        <div className="mt-8 text-center">
          <div className="animate-spin w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-500">AI аналізує ваші потреби та каталог...</p>
          <p className="text-xs text-gray-400 mt-1">Це може зайняти 10-20 секунд</p>
        </div>
      )}

      {/* Results */}
      {step === 99 && (
        <div>
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Результати AI підбору</h2>

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

              <div className={`grid gap-4 ${products.length === 1 ? "grid-cols-1 max-w-sm" : products.length === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"}`}>
                {products.map((product) => (
                  <ProductComparisonCard key={product.id} product={product} />
                ))}
              </div>

              {showComparison && products.length >= 2 && (
                <div className="mt-6 bg-white border border-gray-200 rounded-xl p-4">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">Порівняння товарів</h3>
                  <ComparisonTable products={products} />
                </div>
              )}
            </div>
          )}

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

          <button onClick={reset} className="mt-6 bg-yellow-400 text-black px-6 py-3 rounded-xl hover:bg-yellow-300 font-semibold transition">
            Підібрати ще раз
          </button>
        </div>
      )}
    </div>
  );
}
