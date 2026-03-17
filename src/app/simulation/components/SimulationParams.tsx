"use client";

import type { SimulationType } from "@/lib/simulation/specs";

interface Props {
  simType: SimulationType;
  params: Record<string, number>;
  onChange: (params: Record<string, number>) => void;
  isChainsaw?: boolean;
}

const PARAM_CONFIG: Record<SimulationType, { key: string; label: string; unit: string; min: number; max: number; step: number; default: number }[]> = {
  cutting: [
    { key: "thicknessMm", label: "Товщина матеріалу", unit: "мм", min: 1, max: 50, step: 1, default: 10 },
  ],
  grinding: [
    { key: "surfaceAreaCm2", label: "Площа поверхні", unit: "см²", min: 10, max: 500, step: 10, default: 100 },
  ],
  drilling: [
    { key: "depthMm", label: "Глибина отвору", unit: "мм", min: 5, max: 200, step: 5, default: 30 },
    { key: "holeDiameterMm", label: "Діаметр отвору", unit: "мм", min: 3, max: 30, step: 1, default: 8 },
  ],
};

export default function SimulationParams({ simType, params, onChange, isChainsaw }: Props) {
  let config = PARAM_CONFIG[simType];

  if (isChainsaw) {
    config = [
      { key: "logDiameterCm", label: "Діаметр колоди", unit: "см", min: 10, max: 80, step: 5, default: 50 },
    ];
  }

  const getValue = (key: string, defaultVal: number) => params[key] ?? defaultVal;

  const handleChange = (key: string, value: number) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div className="max-w-lg">
      <p className="text-sm text-[#9E9E9E] mb-6">Налаштуйте параметри задачі</p>
      <div className="space-y-6">
        {config.map((p) => (
          <div key={p.key}>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-[#0A0A0A]">{p.label}</label>
              <span className="text-sm font-bold text-[#FFB800]">
                {getValue(p.key, p.default)} {p.unit}
              </span>
            </div>
            <input
              type="range"
              min={p.min}
              max={p.max}
              step={p.step}
              value={getValue(p.key, p.default)}
              onChange={(e) => handleChange(p.key, Number(e.target.value))}
              className="w-full h-2 bg-[#EFEFEF] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#FFD600] [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#0A0A0A] [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-[#9E9E9E] mt-1">
              <span>{p.min} {p.unit}</span>
              <span>{p.max} {p.unit}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
