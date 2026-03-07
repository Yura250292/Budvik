"use client";

import { useState } from "react";
import AiMarkdown from "@/components/ai/AiMarkdown";

const TASK_TYPES = [
  { value: "concrete", label: "Бетон / Цегла / Камінь" },
  { value: "wood", label: "Дерево / Фанера / ДСП" },
  { value: "metal", label: "Метал / Профіль / Труби" },
  { value: "tile", label: "Плитка / Кераміка" },
  { value: "drywall", label: "Гіпсокартон / Сухі суміші" },
  { value: "painting", label: "Фарбування / Оздоблення" },
  { value: "measuring", label: "Вимірювання / Розмітка" },
  { value: "universal", label: "Універсальне використання" },
];

const FREQUENCIES = [
  { value: "home", label: "Для дому (рідко)" },
  { value: "renovation", label: "Ремонт (помірно)" },
  { value: "professional", label: "Професійне (щоденно)" },
];

const BUDGETS = [
  { value: "до 1000 грн", label: "До 1000 грн" },
  { value: "1000-3000 грн", label: "1000 - 3000 грн" },
  { value: "3000-6000 грн", label: "3000 - 6000 грн" },
  { value: "6000-10000 грн", label: "6000 - 10000 грн" },
  { value: "більше 10000 грн", label: "Більше 10000 грн" },
];

export default function WizardPage() {
  const [step, setStep] = useState(1);
  const [taskType, setTaskType] = useState("");
  const [frequency, setFrequency] = useState("");
  const [budget, setBudget] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);

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
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">AI Підбір інструментів</h1>
      <p className="text-gray-500 mb-8">Відповідайте на питання, і AI підбере найкращі інструменти для вас</p>

      {/* Progress */}
      <div className="flex items-center mb-8">
        {[1, 2, 3].map((s) => (
          <div key={s} className="flex items-center flex-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
              step >= s ? "bg-orange-600 text-white" : "bg-gray-200 text-gray-500"
            }`}>
              {step > s ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                s
              )}
            </div>
            {s < 3 && <div className={`flex-1 h-1 mx-2 rounded ${step > s ? "bg-orange-600" : "bg-gray-200"}`} />}
          </div>
        ))}
      </div>

      {/* Step 1: Task Type */}
      {step === 1 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Який тип роботи?</h2>
          <div className="grid grid-cols-2 gap-3">
            {TASK_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => { setTaskType(t.value); setStep(2); }}
                className={`p-4 rounded-lg border-2 text-left transition ${
                  taskType === t.value
                    ? "border-orange-600 bg-orange-50"
                    : "border-gray-200 hover:border-orange-300"
                }`}
              >
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
                    ? "border-orange-600 bg-orange-50"
                    : "border-gray-200 hover:border-orange-300"
                }`}
              >
                <span className="font-medium text-gray-900">{f.label}</span>
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
                    ? "border-orange-600 bg-orange-50"
                    : "border-gray-200 hover:border-orange-300"
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
              className="bg-orange-600 text-white px-8 py-3 rounded-lg hover:bg-orange-500 disabled:opacity-50 font-semibold transition"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                  AI підбирає...
                </span>
              ) : (
                "Підібрати інструменти"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Results */}
      {step === 4 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">Результати AI підбору</h2>
          <div className="bg-white border rounded-xl p-6">
            <AiMarkdown content={result} />
          </div>
          <button
            onClick={reset}
            className="mt-6 bg-orange-600 text-white px-6 py-3 rounded-lg hover:bg-orange-500 font-semibold transition"
          >
            Підібрати ще раз
          </button>
        </div>
      )}
    </div>
  );
}
