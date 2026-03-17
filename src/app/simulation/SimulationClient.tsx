"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import ProductPicker from "./components/ProductPicker";
import MaterialSelector from "./components/MaterialSelector";
import SimulationParams from "./components/SimulationParams";
import ResultCard from "./components/ResultCard";
import ComparisonView from "./components/ComparisonView";
import SimulationCanvas from "./components/SimulationCanvas";
import RacingCanvas from "./components/RacingCanvas";
import RadarChart from "./components/RadarChart";
import ConsumablePicker from "./components/ConsumablePicker";
import InteractiveSimCanvas from "./components/InteractiveSimCanvas";
import type { SimulationResult } from "@/lib/simulation/engine";
import type { SimulationType } from "@/lib/simulation/specs";
import { CONSUMABLE_MODES, type ConsumableMode, type Consumable } from "@/lib/simulation/consumables";
import { MATERIALS, getCompatibleMaterials, type MaterialContext } from "@/lib/simulation/materials";

interface ProductItem {
  id: string;
  name: string;
  image?: string | null;
  category?: { name: string } | null;
}

type Mode = "tools" | "consumables";

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
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState(0); // 0 = mode select
  // Tools mode
  const [simType, setSimType] = useState<SimulationType | null>(null);
  const [selectedProducts, setSelectedProducts] = useState<ProductItem[]>([]);
  // Consumables mode
  const [consumableMode, setConsumableMode] = useState<ConsumableMode | null>(null);
  const [selectedTool, setSelectedTool] = useState<ProductItem | null>(null);
  const [selectedConsumables, setSelectedConsumables] = useState<Consumable[]>([]);
  // Shared
  const [materialId, setMaterialId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, number>>({});
  const [results, setResults] = useState<SimulationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiReasonings, setAiReasonings] = useState<Record<string, string>>({});
  // Sync: hold fetched data until animation completes
  const [dataReady, setDataReady] = useState(false);
  const pendingRef = useRef<{
    results: SimulationResult[];
    aiAnalysis: string | null;
    aiReasonings: Record<string, string>;
    targetStep: number;
  } | null>(null);

  // Pre-select product from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const productId = urlParams.get("product");
    if (productId) {
      fetch(`/api/simulate/products?search=`)
        .then((r) => r.json())
        .then((products: ProductItem[]) => {
          const found = products.find((p) => p.id === productId);
          if (found) {
            setSelectedProducts([found]);
            setSelectedTool(found);
          }
        })
        .catch(() => {});
    }
  }, []);

  // ===== TOOLS MODE STEPS =====
  // 0: mode select, 1: sim type, 2: tools, 3: material, 4: params, 5: results

  // ===== CONSUMABLES MODE STEPS =====
  // 0: mode select, 1: consumable category, 2: select tool (optional), 3: select consumables, 4: material, 5: params, 6: results

  const totalSteps = mode === "consumables" ? 6 : 5;
  const resultStep = mode === "consumables" ? 7 : 5;

  const getStepLabels = (): string[] => {
    if (mode === "consumables") {
      return ["Категорія", "Інструмент", "Витратні", "Матеріал", "Параметри"];
    }
    return ["Операція", "Інструмент", "Матеріал", "Параметри"];
  };

  const canProceed = useCallback(() => {
    if (step === 0) return !!mode;
    if (mode === "tools") {
      switch (step) {
        case 1: return !!simType;
        case 2: return selectedProducts.length > 0;
        case 3: return !!materialId;
        case 4: return true;
        default: return false;
      }
    } else {
      switch (step) {
        case 1: return !!consumableMode;
        case 2: return true; // tool is optional
        case 3: return selectedConsumables.length >= 2;
        case 4: return !!materialId;
        case 5: return true;
        default: return false;
      }
    }
  }, [step, mode, simType, selectedProducts, materialId, consumableMode, selectedConsumables]);

  // Called by animation when its cycle finishes — reveals results
  const handleAnimComplete = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    setResults(p.results);
    setAiAnalysis(p.aiAnalysis);
    setAiReasonings(p.aiReasonings);
    setStep(p.targetStep);
    setLoading(false);
    setDataReady(false);
    pendingRef.current = null;
  }, []);

  const handleSimulateTools = async () => {
    if (!simType || !materialId || selectedProducts.length === 0) return;
    setLoading(true);
    setDataReady(false);
    pendingRef.current = null;
    try {
      // 1. Fetch simulation results
      let simResults: SimulationResult[] = [];
      if (selectedProducts.length === 1) {
        const res = await fetch("/api/simulate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productId: selectedProducts[0].id, materialId, type: simType, params }),
        });
        const data = await res.json();
        if (data.result) simResults = [data.result];
      } else {
        const res = await fetch("/api/simulate/compare", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ productIds: selectedProducts.map(p => p.id), materialId, type: simType, params }),
        });
        const data = await res.json();
        if (data.results) simResults = data.results;
      }
      if (simResults.length === 0) { setLoading(false); return; }

      // 2. Fetch AI analysis in parallel (already have sim results)
      let aiResult: string | null = null;
      try {
        const materialName = MATERIALS.find(m => m.id === materialId)?.nameUk || materialId;
        const aiRes = await fetch("/api/simulate/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            results: simResults, materialName, simType,
            toolNames: simResults.map(r => r.consumableName || r.toolName),
          }),
        });
        const aiData = await aiRes.json();
        if (aiData.analysis) aiResult = aiData.analysis;
      } catch { /* AI optional */ }

      // 3. Signal animation: all data ready — wait for animation cycle to finish
      pendingRef.current = { results: simResults, aiAnalysis: aiResult, aiReasonings: {}, targetStep: resultStep };
      setDataReady(true);
    } catch { setLoading(false); }
  };

  const handleSimulateConsumables = async () => {
    if (!materialId || !consumableMode || selectedConsumables.length < 2) return;
    setLoading(true);
    setDataReady(false);
    pendingRef.current = null;
    const effectiveSimType = CONSUMABLE_MODES.find(m => m.id === consumableMode)?.simType || "cutting";
    try {
      const res = await fetch("/api/simulate/consumables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedTool?.id || null,
          materialId, consumableMode,
          consumableIds: selectedConsumables.map(c => c.id),
          params,
        }),
      });
      const data = await res.json();
      if (!data.results) { setLoading(false); return; }

      const simResults: SimulationResult[] = data.results;
      const reasonings: Record<string, string> = data.aiReasonings || {};

      let aiResult: string | null = null;
      try {
        const materialName = MATERIALS.find(m => m.id === materialId)?.nameUk || materialId;
        const aiRes = await fetch("/api/simulate/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            results: simResults, materialName, simType: effectiveSimType,
            toolNames: simResults.map(r => r.consumableName || r.toolName),
          }),
        });
        const aiData = await aiRes.json();
        if (aiData.analysis) aiResult = aiData.analysis;
      } catch { /* AI optional */ }

      pendingRef.current = { results: simResults, aiAnalysis: aiResult, aiReasonings: reasonings, targetStep: resultStep };
      setDataReady(true);
    } catch { setLoading(false); }
  };

  const isLastInputStep = () => {
    if (mode === "tools") return step === 4;
    return step === 5;
  };

  const handleNext = () => {
    if (isLastInputStep()) {
      mode === "tools" ? handleSimulateTools() : handleSimulateConsumables();
    } else {
      setStep(s => s + 1);
    }
  };

  const handleBack = () => {
    if (step === resultStep) setResults([]);
    if (step === 0) return;
    setStep(s => s - 1);
  };

  const handleReset = () => {
    setStep(0);
    setMode(null);
    setSimType(null);
    setSelectedProducts([]);
    setConsumableMode(null);
    setSelectedTool(null);
    setSelectedConsumables([]);
    setMaterialId(null);
    setParams({});
    setResults([]);
    setAiAnalysis(null);
    setAiLoading(false);
    setAiReasonings({});
  };

  // Determine material context for filtering
  const getMaterialContext = (): MaterialContext | undefined => {
    if (mode === "consumables" && consumableMode) {
      return consumableMode as MaterialContext;
    }
    if (mode === "tools" && simType) {
      // Check if all selected tools are chainsaws
      if (selectedProducts.length > 0) {
        const allChainsaws = selectedProducts.every(p => {
          const lower = p.name.toLowerCase();
          return /бензопил|ланцюгов\w+\s+пил|електропил/.test(lower);
        });
        if (allChainsaws) return "chainsaw";

        const allCircularSaws = selectedProducts.every(p => {
          const lower = p.name.toLowerCase();
          return /циркулярн|дисков\w+\s+пил/.test(lower);
        });
        if (allCircularSaws) return "circular_saw";

        const allJigsaws = selectedProducts.every(p => {
          const lower = p.name.toLowerCase();
          return /лобзик/.test(lower);
        });
        if (allJigsaws) return "jigsaw";
      }
      return simType as MaterialContext;
    }
    return undefined;
  };

  const materialContext = getMaterialContext();

  // Clear material selection if it's no longer compatible with context
  useEffect(() => {
    if (materialId && materialContext) {
      const compatible = getCompatibleMaterials(materialContext);
      if (!compatible.some(m => m.id === materialId)) {
        setMaterialId(null);
      }
    }
  }, [materialContext, materialId]);

  const isResults = step === resultStep && results.length > 0;
  const currentSimType = mode === "tools"
    ? simType
    : consumableMode
      ? (CONSUMABLE_MODES.find(m => m.id === consumableMode)?.simType as SimulationType) || "cutting"
      : "cutting";

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
          <p className="text-sm text-[#9E9E9E]">
            {mode === "consumables" ? "Порівняння витратних матеріалів" : "Перевірте продуктивність перед покупкою"}
          </p>
        </div>
      </div>

      {/* Steps indicator + top nav */}
      {step > 0 && !isResults && !loading && (
        <div className="flex items-center justify-between gap-3 mb-6">
          {/* Step pills */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 min-w-0">
            {getStepLabels().map((label, i) => (
              <div key={label} className="flex items-center gap-2 shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold transition-[background-color,color] duration-150 ${
                  i + 1 === step ? "bg-[#FFD600] text-[#0A0A0A]" : i + 1 < step ? "bg-[#0A0A0A] text-white" : "bg-[#EFEFEF] text-[#9E9E9E]"
                }`}>
                  {i + 1 < step ? "✓" : i + 1}
                </div>
                <span className={`text-sm hidden sm:inline ${i + 1 === step ? "text-[#0A0A0A] font-semibold" : "text-[#9E9E9E]"}`}>{label}</span>
                {i < getStepLabels().length - 1 && <div className="w-6 h-px bg-[#EFEFEF] hidden sm:block" />}
              </div>
            ))}
          </div>
          {/* Top "Next" button */}
          <button
            onClick={handleNext}
            disabled={!canProceed() || loading}
            className="shrink-0 bg-[#FFD600] text-[#0A0A0A] px-5 py-2 rounded-xl text-sm font-semibold hover:bg-[#FFC400] transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isLastInputStep() ? "Симулювати" : "Далі"}
            {!isLastInputStep() && (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
      )}

      {/* Step 0: Mode Selection */}
      {step === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => setMode("tools")}
            className={`p-6 rounded-2xl border-2 text-left cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color,transform] duration-150 ${
              mode === "tools" ? "border-[#FFD600] bg-[#FFFDE7] shadow-md" : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/50"
            }`}
          >
            <div className="text-3xl mb-3">🔧</div>
            <h3 className="text-lg font-bold text-[#0A0A0A] mb-1">Порівняти інструменти</h3>
            <p className="text-sm text-[#9E9E9E]">Тестуйте 2-4 моделі на одному матеріалі. Наприклад: 4 бензопили на колоді</p>
          </button>
          <button
            onClick={() => setMode("consumables")}
            className={`p-6 rounded-2xl border-2 text-left cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color,transform] duration-150 ${
              mode === "consumables" ? "border-[#FFD600] bg-[#FFFDE7] shadow-md" : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/50"
            }`}
          >
            <div className="text-3xl mb-3">💿</div>
            <h3 className="text-lg font-bold text-[#0A0A0A] mb-1">Порівняти витратні</h3>
            <p className="text-sm text-[#9E9E9E]">Обрати дриль → порівняти свердла. Або болгарку → порівняти відрізні диски</p>
          </button>
        </div>
      )}

      {/* ===== TOOLS MODE ===== */}
      {mode === "tools" && step === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {SIM_TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setSimType(t.id)}
              className={`p-6 rounded-2xl border-2 text-center cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color,transform] duration-150 ${
                simType === t.id ? "border-[#FFD600] bg-[#FFFDE7] shadow-md" : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/50"
              }`}
            >
              <div className={`mx-auto mb-3 ${simType === t.id ? "text-[#FFB800]" : "text-[#9E9E9E]"}`}>{t.icon}</div>
              <h3 className="text-lg font-bold text-[#0A0A0A]">{t.label}</h3>
            </button>
          ))}
        </div>
      )}
      {mode === "tools" && step === 2 && simType && (
        <ProductPicker simType={simType} selected={selectedProducts} onSelect={setSelectedProducts} />
      )}
      {mode === "tools" && step === 3 && (
        <MaterialSelector selected={materialId} onSelect={setMaterialId} context={materialContext} />
      )}
      {mode === "tools" && step === 4 && simType && (
        <SimulationParams simType={simType} params={params} onChange={setParams} />
      )}

      {/* ===== CONSUMABLES MODE ===== */}
      {mode === "consumables" && step === 1 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {CONSUMABLE_MODES.map((cm) => (
            <button
              key={cm.id}
              onClick={() => setConsumableMode(cm.id)}
              className={`p-6 rounded-2xl border-2 text-left cursor-pointer active:scale-[0.98] transition-[box-shadow,border-color,background-color,transform] duration-150 ${
                consumableMode === cm.id ? "border-[#FFD600] bg-[#FFFDE7] shadow-md" : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/50"
              }`}
            >
              <div className="text-3xl mb-2">{cm.icon}</div>
              <h3 className="text-lg font-bold text-[#0A0A0A]">{cm.label}</h3>
            </button>
          ))}
        </div>
      )}
      {mode === "consumables" && step === 2 && consumableMode && (
        <div>
          <p className="text-sm text-[#9E9E9E] mb-4">Оберіть інструмент (або пропустіть для стандартного)</p>
          <ProductPicker
            simType={(CONSUMABLE_MODES.find(m => m.id === consumableMode)?.simType || "cutting") as SimulationType}
            selected={selectedTool ? [selectedTool] : []}
            onSelect={(items) => setSelectedTool(items[0] || null)}
          />
        </div>
      )}
      {mode === "consumables" && step === 3 && consumableMode && (
        <div>
          <h3 className="text-lg font-bold text-[#0A0A0A] mb-1">
            {selectedTool ? `Витратні для: ${selectedTool.name.substring(0, 40)}` : "Оберіть витратні матеріали"}
          </h3>
          <p className="text-sm text-[#9E9E9E] mb-4">Мінімум 2, максимум 4 для порівняння</p>
          <ConsumablePicker
            mode={consumableMode}
            selected={selectedConsumables}
            onSelect={setSelectedConsumables}
            materialId={materialId}
          />
        </div>
      )}
      {mode === "consumables" && step === 4 && (
        <MaterialSelector selected={materialId} onSelect={setMaterialId} context={materialContext} />
      )}
      {mode === "consumables" && step === 5 && consumableMode && (
        <SimulationParams
          simType={(CONSUMABLE_MODES.find(m => m.id === consumableMode)?.simType || "cutting") as SimulationType}
          params={params}
          onChange={setParams}
          isChainsaw={consumableMode === "chainsaw"}
        />
      )}

      {/* ===== LOADING — Interactive 3D simulation ===== */}
      {loading && (
        <div className="space-y-4">
          <InteractiveSimCanvas
            type={currentSimType as "cutting" | "grinding" | "drilling"}
            dataReady={dataReady}
            onComplete={handleAnimComplete}
          />
        </div>
      )}

      {/* ===== RESULTS (both modes) ===== */}
      {isResults && !loading && (
        <div>
          {/* Racing animation for comparisons */}
          {results.length > 1 && (
            <div className="bg-[#0A0A0A] rounded-2xl overflow-hidden mb-6" style={{ height: Math.max(200, results.length * 80 + 40) }}>
              <RacingCanvas
                results={results}
                type={currentSimType as "cutting" | "grinding" | "drilling"}
              />
            </div>
          )}

          {/* Single result animation */}
          {results.length === 1 && (
            <div className="bg-[#0A0A0A] rounded-2xl overflow-hidden mb-6" style={{ height: 220 }}>
              <SimulationCanvas
                type={currentSimType as SimulationType}
                results={results}
              />
            </div>
          )}

          {results.length === 1 ? (
            <ResultCard result={results[0]} />
          ) : (
            <>
              <ComparisonView results={results} />

              {/* AI Reasoning per product */}
              {Object.keys(aiReasonings).length > 0 && (
                <div className="mt-4 space-y-2">
                  {results.map((r) => {
                    const reason = aiReasonings[r.consumableId || ""];
                    if (!reason) return null;
                    return (
                      <div key={r.consumableId} className="flex items-start gap-2 bg-[#FFFDE7] rounded-xl px-4 py-3 border border-[#FFD600]/20">
                        <span className="text-[#FFD600] text-sm mt-0.5">AI</span>
                        <div>
                          <p className="text-xs font-semibold text-[#0A0A0A] mb-0.5">{r.consumableName || r.toolName}</p>
                          <p className="text-xs text-[#555] leading-relaxed">{reason}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="mt-6">
                <h3 className="text-lg font-bold text-[#0A0A0A] mb-3">Діаграма метрик</h3>
                <div className="bg-white rounded-2xl border border-[#EFEFEF] p-4" style={{ height: 320 }}>
                  <RadarChart results={results} />
                </div>
              </div>
            </>
          )}

          {/* AI Analysis */}
          <div className="mt-6 bg-gradient-to-br from-[#0A0A0A] to-[#1A1A1A] rounded-2xl p-5 text-white">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-[#FFD600]" viewBox="0 0 24 24" fill="none">
                <path d="M4 14C4 8.5 8 4 12 4C16 4 20 8.5 20 14V16H4V14Z" fill="#FFD600" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M4 12H20" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M4 12L1 6" stroke="#FFD600" strokeWidth="2" strokeLinecap="round"/>
                <path d="M20 12L23 6" stroke="#FFD600" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <h3 className="text-base font-bold text-[#FFD600]">AI Аналіз</h3>
              <span className="text-[10px] text-white/40 ml-auto">Gemini</span>
            </div>
            {aiAnalysis ? (
              <p className="text-sm text-white/85 leading-relaxed whitespace-pre-line">{aiAnalysis}</p>
            ) : (
              <p className="text-sm text-white/40">Не вдалося отримати AI аналіз</p>
            )}
          </div>

          <div className="mt-6 text-center">
            <button onClick={handleReset} className="bg-[#FFD600] text-[#0A0A0A] px-8 py-3 rounded-xl font-semibold hover:bg-[#FFC400] transition">
              Нова симуляція
            </button>
          </div>
        </div>
      )}

      {/* Navigation buttons */}
      {!isResults && !loading && (
        <div className="flex items-center justify-between mt-8">
          <button
            onClick={handleBack}
            disabled={step === 0}
            className="px-6 py-2.5 rounded-xl text-sm font-semibold transition disabled:opacity-30 disabled:cursor-not-allowed text-[#555] hover:bg-[#EFEFEF]"
          >
            Назад
          </button>
          <button
            onClick={handleNext}
            disabled={!canProceed() || loading}
            className="bg-[#FFD600] text-[#0A0A0A] px-8 py-2.5 rounded-xl text-sm font-semibold hover:bg-[#FFC400] transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? "AI аналізує..." : isLastInputStep() ? "Симулювати з AI" : "Далі"}
          </button>
        </div>
      )}
    </div>
  );
}
