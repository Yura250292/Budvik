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

/**
 * Context-aware material filtering.
 * Returns material IDs relevant for a given tool/consumable context.
 */
export type MaterialContext =
  | "chainsaw"        // бензопили/ланцюги → тільки дерево
  | "cutting_discs"   // відрізні диски (болгарка) → метал, камінь, плитка (не дерево)
  | "grinding_discs"  // шліфувальні диски → метал, дерево, камінь
  | "drill_bits"      // свердла/бури → все
  | "cutting"         // різання (загальне) → все
  | "grinding"        // шліфування → все
  | "drilling"        // свердління → все
  | "circular_saw"    // циркулярні пили → дерево, алюміній
  | "jigsaw";         // лобзик → дерево, алюміній, пластик

const MATERIAL_FILTER: Record<MaterialContext, string[]> = {
  chainsaw:       ["wood_soft", "wood_hard"],
  circular_saw:   ["wood_soft", "wood_hard", "aluminum"],
  jigsaw:         ["wood_soft", "wood_hard", "aluminum"],
  cutting_discs:  ["mild_steel", "stainless", "aluminum", "concrete", "brick", "tile"],
  grinding_discs: ["mild_steel", "stainless", "aluminum", "wood_hard", "wood_soft", "concrete", "tile"],
  drill_bits:     ["mild_steel", "stainless", "concrete", "wood_soft", "wood_hard", "aluminum", "brick", "tile"],
  cutting:        ["mild_steel", "stainless", "aluminum", "concrete", "wood_soft", "wood_hard", "brick", "tile"],
  grinding:       ["mild_steel", "stainless", "aluminum", "wood_soft", "wood_hard", "concrete", "tile"],
  drilling:       ["mild_steel", "stainless", "concrete", "wood_soft", "wood_hard", "aluminum", "brick", "tile"],
};

export function getCompatibleMaterials(context: MaterialContext): Material[] {
  const ids = MATERIAL_FILTER[context];
  if (!ids) return MATERIALS;
  return MATERIALS.filter(m => ids.includes(m.id));
}
