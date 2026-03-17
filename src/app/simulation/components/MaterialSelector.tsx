"use client";

import { MATERIALS, getCompatibleMaterials, type MaterialContext } from "@/lib/simulation/materials";

interface Props {
  selected: string | null;
  onSelect: (id: string) => void;
  context?: MaterialContext;
}

export default function MaterialSelector({ selected, onSelect, context }: Props) {
  const materials = context ? getCompatibleMaterials(context) : MATERIALS;

  return (
    <div>
      <p className="text-sm text-[#9E9E9E] mb-4">Оберіть матеріал для симуляції</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {materials.map((m) => (
          <button
            key={m.id}
            onClick={() => onSelect(m.id)}
            className={`p-4 rounded-2xl border-2 text-left transition-all ${
              selected === m.id
                ? "border-[#FFD600] bg-[#FFFDE7] shadow-sm"
                : "border-[#EFEFEF] bg-white hover:border-[#FFD600]/40"
            }`}
          >
            <div className="text-2xl mb-2">{m.icon}</div>
            <h4 className="text-sm font-bold text-[#0A0A0A] mb-2">{m.nameUk}</h4>
            {/* Hardness bar */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[#9E9E9E]">Твердість</span>
              <div className="flex-1 h-1.5 bg-[#EFEFEF] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${(m.hardness / 10) * 100}%`,
                    backgroundColor: m.hardness >= 7 ? "#EF4444" : m.hardness >= 4 ? "#F59E0B" : "#22C55E",
                  }}
                />
              </div>
              <span className="text-[10px] font-bold text-[#555]">{m.hardness}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
