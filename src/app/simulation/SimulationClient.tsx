"use client";

import { useState, useCallback, useEffect, type ReactNode } from "react";
import ProductPicker from "./components/ProductPicker";
import MaterialSelector from "./components/MaterialSelector";
import SimulationParams from "./components/SimulationParams";
import ResultCard from "./components/ResultCard";
import ComparisonView from "./components/ComparisonView";
import SimulationCanvas from "./components/SimulationCanvas";
import RadarChart from "./components/RadarChart";
import type { SimulationResult } from "@/lib/simulation/engine";
import type { SimulationType } from "@/lib/simulation/specs";

interface ProductItem {
  id: string;
  name: string;
  image?: string | null;
  category?: { name: string } | null;
}

const SIM_TYPES: { id: SimulationType; label: string; icon: ReactNode }[] = [
  {
    id: "cutting",
    label: "Різання",
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="12" r="8" strokeDasharray="4 2" />
        <line x1="4" y1="20" x2="20" y2="4" strokeWidth={2} />
      </svg>
    ),
  },
  {
    id: "grinding",
    label: "Шліфування",
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="12" cy="10" r="7" />
        <path d="M8 17h8v3H8z" />
        <line x1="5" y1="21" x2="19" y2="21" strokeWidth={2} />
      </svg>
    ),
  },
  {
    id: "drilling",
    label: "Свердління",
    icon: (
      <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path d="M12 2v14M9 16l3 6 3-6" />
        <path d="M8 6l4 2 4-2M7 10l5 2 5-2" />
      </svg>
    ),
  },
];

export default function SimulationClient() {
  const [step, setStep] = useState(1);
  const [simType, setSimType] = useState<SimulationType | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<ProductItem[]>([]);
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, number>>({});
  const [results, setResults] = useState<SimulationResult[]>([]);
  const [loading, setLoading] = useState(false);

  // Pre-select product from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get("product");
    if (productId) {
      fetch(`/api/simulate/products?search=`)
        .then((r) => r.json())
        .then((products: ProductItem[]) => {
          const found = products.find((p) => p.id === productId);
          if (found) setSelectedProducts([found]);
        })
        .catch(() => {});
    }
  }, []);

  const canProceed = useCallback(() => {
    switch (step) {
      case 1: return !!simType;
      case 2: return selectedProducts.length > 0;
      case 3: return !!materialId;
      case 4: return true;
      default: return false;
    }
  }, [step, simType, selectedProducts, materialId]);

  const handleSimulate = async () => {
    if (!simType || !materialId || selectedProducts.length === 0) return;
    setLoading(true);

    try {
      if (selectedProducts.length === 1) {
        const res = await fetch("/api/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: selectedProducts[0].id,
            materialId,
            type: simType,
            params,
          }),
        });
        const data = await res.json();
        if (data.result) {
          setResults([data.result]);
          setStep(5);
        }
      } else {
        const res = await fetch("/api/simulate/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productIds: selectedProducts.map((p) => p.id),
            materialId,
            type: simType,
            params,
          }),
        });
        const data = await res.json();
        if (data.results) {
          setResults(data.results);
          setStep(5);
        }
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleNext = () => {
    if (step === 4) {
      handleSimulate();
    } else {
      setStep((s) => s + 1);
    }
  };

  const handleBack = () => {
    if (step === 5) {
      setResults([]);
    }
    setStep((s) => Math.max(1, s - 1));
  };

  const handleReset = () => {
    setStep(1);
    setSimType(null);
    setSelectedProducts([]);
    setMaterialId(null);
    setParams({});
    setResults([]);
  };

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8 mb-20 md:mb-0">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 bg-[#FFD600] rounded-xl flex items-center justify-center">
          <svg className="w-6 h-6 text-[#0A0A0A]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#0A0A0A]">Симуляція інструментів</h1>
          <p className="text-sm text-[#9E9E9E]">Перевірте продуктивність перед покупкою</p>
        </div>
      </div>

      {/* Steps indicator */}
      {step < 5 && (
        <div className="flex items-center gap-2 mb-8 overflow-x-auto pb-2">
          {["Операція", "Інструмент", "Матеріал", "Параметри"].map((label, i) => (
            <div key={label} className="flex items-center gap-2 shrink-0">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  i + 1 === step
                    ? "bg-[#FFD600] text-[#0A0A0A]"
                    : i + 1 < step
                    ? "bg-[#0A0A0A] text-white"
                    : "bg-[#EFEFEF] text-[#9E9E9E]"
                }`}
              >
                {i + 1 < step ? "✓" : i + 1}
              </div>
              <span className={`text-sm ${i + 1 === step ? "text-[#0A0A0A] font-semibold" : "text-[#9E9E9E]"}`}>
                {label}
              </span>
              {i < 3 && <div className="w-8 h-px bg-[#EFEFEF]" />}
            </div>
          ))}
        </div>
      )}

      {/* Step 1: Simulation Type */}
      {step === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {SIM_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setSimType(t.id)}
              className={`p-6 rounded-2xl border-2 transition-all text-center ${
                simType === t.id
                  ? "border-[#FFD600] bg-[#FFFDE7] shadow-md"
                  : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/50"
              }`}
            >
              <div className={`mx-auto mb-3 ${simType === t.id ? "text-[#FFB800]" : "text-[#9E9E9E]"}`}>
                {t.icon}
              </div>
              <h3 className="text-lg font-bold text-[#0A0A0A]">{t.label}</h3>
            </button>
          ))}
        </div>
      )}

      {/* Step 2: Product Selection */}
      {step === 2 && simType && (
        <ProductPicker
          simType={simType}
          selected={selectedProducts}
          onSelect={setSelectedProducts}
        />
      )}

      {/* Step 3: Material Selection */}
      {step === 3 && (
        <MaterialSelector selected={materialId} onSelect={setMaterialId} />
      )}

      {/* Step 4: Parameters */}
      {step === 4 && simType && (
        <SimulationParams simType={simType} params={params} onChange={setParams} />
      )}

      {/* Step 5: Results */}
      {step === 5 && results.length > 0 && (
        <div>
          {/* Animation */}
          <div className="bg-[#0A0A0A] rounded-2xl overflow-hidden mb-6" style={{ height: 220 }}>
            <SimulationCanvas
              type={results[0].type as SimulationType}
              results={results}
              materialColor={materialId ? undefined : "#9E9E9E"}
            />
          </div>

          {results.length === 1 ? (
            <ResultCard result={results[0]} />
          ) : (
            <>
              <ComparisonView results={results} />
              <div className="mt-6">
                <h3 className="text-lg font-bold text-[#0A0A0A] mb-3">Діаграма метрик</h3>
                <div className="bg-white rounded-2xl border border-[#EFEFEF] p-4" style={{ height: 320 }}>
                  <RadarChart results={results} />
                </div>
              </div>
            </>
          )}

          <div className="mt-6 text-center">
            <button
              onClick={handleReset}
              className="bg-[#FFD600] text-[#0A0A0A] px-8 py-3 rounded-xl font-semibold hover:bg-[#FFC400] transition"
            >
              Нова симуляція
            </button>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      {step < 5 && (
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={handleBack}
            disabled={step === 1}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-30 disabled:cursor-not-allowed text-[#555] hover:bg-[#EFEFEF]"
          >
            Назад
          </button>
          <button
            onClick={handleNext}
            disabled={!canProceed() || loading}
            className="bg-[#FFD600] text-[#0A0A0A] px-8 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FFC400] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "Обчислення..." : step === 4 ? "Симулювати" : "Далі"}
          </button>
        </div>
      )}
    </div>
  );
}
