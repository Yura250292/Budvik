export interface Material {
  id: string;
  nameUk: string;
  icon: string;
  hardness: number; // 1-10
  density: number; // kg/m³
  cuttingResistance: number; // 0.1-1.0
  grindingResistance: number;
  drillingResistance: number;
  color: string; // for canvas particles
}

export const MATERIALS: Material[] = [
  {
    id: "mild_steel",
    nameUk: "Сталь м'яка",
    icon: "🔩",
    hardness: 5,
    density: 7850,
    cuttingResistance: 0.7,
    grindingResistance: 0.6,
    drillingResistance: 0.65,
    color: "#8B8B8B",
  },
  {
    id: "stainless",
    nameUk: "Нержавіюча сталь",
    icon: "⚙️",
    hardness: 6.5,
    density: 8000,
    cuttingResistance: 0.85,
    grindingResistance: 0.8,
    drillingResistance: 0.8,
    color: "#C0C0C0",
  },
  {
    id: "concrete",
    nameUk: "Бетон",
    icon: "🧱",
    hardness: 7,
    density: 2400,
    cuttingResistance: 0.9,
    grindingResistance: 0.7,
    drillingResistance: 0.75,
    color: "#9E9E9E",
  },
  {
    id: "wood_soft",
    nameUk: "Деревина м'яка",
    icon: "🪵",
    hardness: 2,
    density: 500,
    cuttingResistance: 0.15,
    grindingResistance: 0.1,
    drillingResistance: 0.1,
    color: "#D2A679",
  },
  {
    id: "wood_hard",
    nameUk: "Деревина тверда",
    icon: "🌳",
    hardness: 4,
    density: 800,
    cuttingResistance: 0.3,
    grindingResistance: 0.25,
    drillingResistance: 0.25,
    color: "#8B6914",
  },
  {
    id: "aluminum",
    nameUk: "Алюміній",
    icon: "🪶",
    hardness: 3,
    density: 2700,
    cuttingResistance: 0.25,
    grindingResistance: 0.2,
    drillingResistance: 0.2,
    color: "#D4D4D4",
  },
  {
    id: "brick",
    nameUk: "Цегла",
    icon: "🟫",
    hardness: 5.5,
    density: 1800,
    cuttingResistance: 0.6,
    grindingResistance: 0.5,
    drillingResistance: 0.55,
    color: "#C2452D",
  },
  {
    id: "tile",
    nameUk: "Плитка керамічна",
    icon: "🔲",
    hardness: 7,
    density: 2300,
    cuttingResistance: 0.8,
    grindingResistance: 0.6,
    drillingResistance: 0.7,
    color: "#E8D5B7",
  },
];

export function getMaterialById(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}
