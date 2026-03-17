"use client";

import { getConsumablesByMode, type ConsumableMode, type Consumable } from "@/lib/simulation/consumables";

interface Props {
  mode: ConsumableMode;
  selected: Consumable[];
  onSelect: (items: Consumable[]) => void;
  materialId?: string | null;
}

export default function ConsumablePicker({ mode, selected, onSelect, materialId }: Props) {
  const items = getConsumablesByMode(mode);

  const toggleItem = (item: Consumable) => {
    const exists = selected.find(s => s.id === item.id);
    if (exists) {
      onSelect(selected.filter(s => s.id !== item.id));
    } else if (selected.length < 4) {
      onSelect([...selected, item]);
    }
  };

  const isSelected = (id: string) => selected.some(s => s.id === id);

  const getCompat = (item: Consumable): "optimal" | "ok" | "incompatible" | null => {
    if (!materialId) return null;
    const val = item.materialCompat[materialId];
    if (val === 2) return "optimal";
    if (val === 1) return "ok";
    if (val === 0) return "incompatible";
    return "ok";
  };

  const compatBadge = (compat: "optimal" | "ok" | "incompatible" | null) => {
    if (!compat) return null;
    const styles = {
      optimal: "bg-green-100 text-green-700 border-green-300",
      ok: "bg-yellow-50 text-yellow-700 border-yellow-300",
      incompatible: "bg-red-50 text-red-600 border-red-300",
    };
    const labels = { optimal: "Оптимально", ok: "Підходить", incompatible: "Не сумісний" };
    return (
      <span className={`text-[9px] px-1.5 py-0.5 rounded border ${styles[compat]}`}>
        {labels[compat]}
      </span>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#9E9E9E]">Обрано: {selected.length}/4</p>
      </div>

      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {selected.map(item => (
            <span key={item.id} className="inline-flex items-center gap-1.5 bg-[#FFFDE7] border border-[#FFD600] text-[#0A0A0A] text-xs font-medium px-3 py-1.5 rounded-lg">
              {item.nameUk}
              <button onClick={() => toggleItem(item)} className="text-[#9E9E9E] hover:text-red-500">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {items.map(item => {
          const compat = getCompat(item);
          const disabled = compat === "incompatible";
          return (
            <button
              key={item.id}
              onClick={() => !disabled && toggleItem(item)}
              disabled={disabled || (!isSelected(item.id) && selected.length >= 4)}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                isSelected(item.id)
                  ? "border-[#FFD600] bg-[#FFFDE7] shadow-sm"
                  : disabled
                  ? "border-[#EFEFEF] bg-[#FAFAFA] opacity-50 cursor-not-allowed"
                  : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/40 disabled:opacity-40 disabled:cursor-not-allowed"
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <h4 className="text-sm font-bold text-[#0A0A0A]">{item.nameUk}</h4>
                {compatBadge(compat)}
              </div>
              <p className="text-[11px] text-[#555] mb-2">{item.description}</p>
              {/* Mini stats */}
              <div className="flex gap-3 text-[10px] text-[#9E9E9E]">
                <span>Швидк. ×{item.speedFactor.toFixed(1)}</span>
                <span>Ресурс ×{item.durabilityFactor.toFixed(1)}</span>
                <span>Точн. ×{item.precisionFactor.toFixed(1)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
