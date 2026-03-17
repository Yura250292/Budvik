export type ConsumableCategory = "drill_bit" | "cutting_disc" | "grinding_disc" | "chainsaw_chain";

export interface Consumable {
  id: string;
  nameUk: string;
  category: ConsumableCategory;
  diameterMm?: number;
  thicknessMm?: number;
  // Performance modifiers (multipliers, 1.0 = baseline)
  speedFactor: number;      // швидкість різання/свердління
  durabilityFactor: number; // стійкість до зносу
  precisionFactor: number;  // якість поверхні / точність
  heatFactor: number;       // генерація тепла (нижче = краще)
  // Material compatibility (0 = incompatible, 1 = ok, 2 = optimal)
  materialCompat: Record<string, number>;
  description: string;
}

// ============ СВЕРДЛА ============
export const DRILL_BITS: Consumable[] = [
  {
    id: "hss_6mm",
    nameUk: "Свердло HSS 6 мм",
    category: "drill_bit",
    diameterMm: 6,
    speedFactor: 1.0,
    durabilityFactor: 0.8,
    precisionFactor: 1.0,
    heatFactor: 1.0,
    materialCompat: { mild_steel: 2, stainless: 1, aluminum: 2, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Стандартне свердло по металу HSS",
  },
  {
    id: "hss_10mm",
    nameUk: "Свердло HSS 10 мм",
    category: "drill_bit",
    diameterMm: 10,
    speedFactor: 0.8,
    durabilityFactor: 0.8,
    precisionFactor: 0.9,
    heatFactor: 1.2,
    materialCompat: { mild_steel: 2, stainless: 1, aluminum: 2, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Свердло HSS збільшеного діаметру",
  },
  {
    id: "cobalt_6mm",
    nameUk: "Свердло кобальтове 6 мм",
    category: "drill_bit",
    diameterMm: 6,
    speedFactor: 1.2,
    durabilityFactor: 1.5,
    precisionFactor: 1.2,
    heatFactor: 0.7,
    materialCompat: { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 1, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Кобальтове свердло — витримує високу температуру",
  },
  {
    id: "cobalt_10mm",
    nameUk: "Свердло кобальтове 10 мм",
    category: "drill_bit",
    diameterMm: 10,
    speedFactor: 1.0,
    durabilityFactor: 1.5,
    precisionFactor: 1.1,
    heatFactor: 0.8,
    materialCompat: { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 1, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Кобальтове свердло 10мм для нержавіючої сталі",
  },
  {
    id: "sds_8mm",
    nameUk: "Бур SDS-plus 8 мм",
    category: "drill_bit",
    diameterMm: 8,
    speedFactor: 1.3,
    durabilityFactor: 1.2,
    precisionFactor: 0.7,
    heatFactor: 0.9,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 },
    description: "Бур по бетону SDS-plus з твердосплавним наконечником",
  },
  {
    id: "sds_12mm",
    nameUk: "Бур SDS-plus 12 мм",
    category: "drill_bit",
    diameterMm: 12,
    speedFactor: 1.1,
    durabilityFactor: 1.2,
    precisionFactor: 0.6,
    heatFactor: 1.0,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 },
    description: "Бур SDS-plus 12мм для перфоратора",
  },
  {
    id: "wood_flat_20mm",
    nameUk: "Перо по дереву 20 мм",
    category: "drill_bit",
    diameterMm: 20,
    speedFactor: 1.5,
    durabilityFactor: 0.6,
    precisionFactor: 0.5,
    heatFactor: 0.6,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Перовое свердло по дереву — швидке, але грубе",
  },
  {
    id: "forstner_25mm",
    nameUk: "Свердло Форстнера 25 мм",
    category: "drill_bit",
    diameterMm: 25,
    speedFactor: 0.7,
    durabilityFactor: 1.0,
    precisionFactor: 1.8,
    heatFactor: 0.8,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Свердло Форстнера — ідеально чистий отвір у дереві",
  },
];

// ============ ВІДРІЗНІ ДИСКИ ============
export const CUTTING_DISCS: Consumable[] = [
  {
    id: "cut_metal_125_1mm",
    nameUk: "Відрізний по металу 125×1.0 мм",
    category: "cutting_disc",
    diameterMm: 125,
    thicknessMm: 1.0,
    speedFactor: 1.3,
    durabilityFactor: 0.6,
    precisionFactor: 1.3,
    heatFactor: 0.8,
    materialCompat: { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 0, wood_hard: 0, concrete: 0, brick: 0, tile: 0 },
    description: "Тонкий диск — швидкий різ, менше нагрів, але зношується швидше",
  },
  {
    id: "cut_metal_125_1.6mm",
    nameUk: "Відрізний по металу 125×1.6 мм",
    category: "cutting_disc",
    diameterMm: 125,
    thicknessMm: 1.6,
    speedFactor: 1.0,
    durabilityFactor: 1.0,
    precisionFactor: 1.0,
    heatFactor: 1.0,
    materialCompat: { mild_steel: 2, stainless: 1, aluminum: 2, wood_soft: 0, wood_hard: 0, concrete: 0, brick: 0, tile: 0 },
    description: "Стандартний відрізний диск — баланс швидкості та ресурсу",
  },
  {
    id: "cut_metal_125_2.5mm",
    nameUk: "Відрізний по металу 125×2.5 мм",
    category: "cutting_disc",
    diameterMm: 125,
    thicknessMm: 2.5,
    speedFactor: 0.7,
    durabilityFactor: 1.6,
    precisionFactor: 0.7,
    heatFactor: 1.4,
    materialCompat: { mild_steel: 2, stainless: 1, aluminum: 1, wood_soft: 0, wood_hard: 0, concrete: 0, brick: 0, tile: 0 },
    description: "Товстий диск — повільніший, але дуже довговічний",
  },
  {
    id: "cut_stone_125",
    nameUk: "Відрізний по каменю 125×2.0 мм",
    category: "cutting_disc",
    diameterMm: 125,
    thicknessMm: 2.0,
    speedFactor: 0.9,
    durabilityFactor: 1.0,
    precisionFactor: 0.8,
    heatFactor: 1.1,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 },
    description: "Диск по каменю та бетону",
  },
  {
    id: "diamond_125",
    nameUk: "Алмазний диск 125 мм",
    category: "cutting_disc",
    diameterMm: 125,
    thicknessMm: 1.8,
    speedFactor: 1.4,
    durabilityFactor: 2.0,
    precisionFactor: 1.5,
    heatFactor: 0.6,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 2 },
    description: "Алмазний диск — найшвидший та найдовговічніший по бетону та плитці",
  },
  {
    id: "diamond_turbo_125",
    nameUk: "Алмазний турбо 125 мм",
    category: "cutting_disc",
    diameterMm: 125,
    thicknessMm: 2.0,
    speedFactor: 1.6,
    durabilityFactor: 1.8,
    precisionFactor: 1.0,
    heatFactor: 0.7,
    materialCompat: { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 },
    description: "Турбо-сегмент — максимальна швидкість по бетону, грубший різ",
  },
];

// ============ ШЛІФУВАЛЬНІ ДИСКИ ============
export const GRINDING_DISCS: Consumable[] = [
  {
    id: "grind_metal_125",
    nameUk: "Зачисний по металу 125×6 мм",
    category: "grinding_disc",
    diameterMm: 125,
    thicknessMm: 6,
    speedFactor: 1.0,
    durabilityFactor: 1.0,
    precisionFactor: 0.8,
    heatFactor: 1.0,
    materialCompat: { mild_steel: 2, stainless: 1, aluminum: 1, wood_soft: 0, wood_hard: 0, concrete: 0, brick: 0, tile: 0 },
    description: "Стандартний зачисний диск по металу",
  },
  {
    id: "flap_disc_60",
    nameUk: "Пелюстковий P60 125 мм",
    category: "grinding_disc",
    diameterMm: 125,
    speedFactor: 0.8,
    durabilityFactor: 1.3,
    precisionFactor: 1.4,
    heatFactor: 0.7,
    materialCompat: { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Пелюстковий диск P60 — чистіша поверхня, менше нагрів",
  },
  {
    id: "flap_disc_120",
    nameUk: "Пелюстковий P120 125 мм",
    category: "grinding_disc",
    diameterMm: 125,
    speedFactor: 0.5,
    durabilityFactor: 1.5,
    precisionFactor: 1.8,
    heatFactor: 0.5,
    materialCompat: { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 },
    description: "Пелюстковий P120 — фінішна обробка, дуже гладка поверхня",
  },
  {
    id: "fiber_disc_36",
    nameUk: "Фібровий P36 125 мм",
    category: "grinding_disc",
    diameterMm: 125,
    speedFactor: 1.4,
    durabilityFactor: 0.7,
    precisionFactor: 0.5,
    heatFactor: 1.3,
    materialCompat: { mild_steel: 2, stainless: 1, aluminum: 1, wood_soft: 1, wood_hard: 1, concrete: 1, brick: 1, tile: 0 },
    description: "Фібровий диск P36 — агресивне зняття матеріалу",
  },
];

// ============ ЛАНЦЮГИ БЕНЗОПИЛ ============
export const CHAINSAW_CHAINS: Consumable[] = [
  {
    id: "chain_325_16",
    nameUk: "Ланцюг .325\" 16\" (40 см)",
    category: "chainsaw_chain",
    speedFactor: 1.0,
    durabilityFactor: 1.0,
    precisionFactor: 1.0,
    heatFactor: 1.0,
    materialCompat: { wood_soft: 2, wood_hard: 2 },
    description: "Стандартний ланцюг .325\" — баланс для загального використання",
  },
  {
    id: "chain_38_18",
    nameUk: "Ланцюг 3/8\" 18\" (45 см)",
    category: "chainsaw_chain",
    speedFactor: 1.3,
    durabilityFactor: 0.9,
    precisionFactor: 0.8,
    heatFactor: 1.1,
    materialCompat: { wood_soft: 2, wood_hard: 2 },
    description: "Ланцюг 3/8\" — швидший різ, для потужних пил",
  },
  {
    id: "chain_chisel",
    nameUk: "Ланцюг з різцями chisel",
    category: "chainsaw_chain",
    speedFactor: 1.5,
    durabilityFactor: 0.7,
    precisionFactor: 1.2,
    heatFactor: 0.9,
    materialCompat: { wood_soft: 2, wood_hard: 2 },
    description: "Chisel-зуб — максимальна швидкість, потребує частого заточування",
  },
  {
    id: "chain_semi_chisel",
    nameUk: "Ланцюг semi-chisel",
    category: "chainsaw_chain",
    speedFactor: 1.1,
    durabilityFactor: 1.4,
    precisionFactor: 0.9,
    heatFactor: 0.8,
    materialCompat: { wood_soft: 2, wood_hard: 2 },
    description: "Semi-chisel — довго тримає заточку, для брудної деревини",
  },
];

export type ConsumableMode = "drill_bits" | "cutting_discs" | "grinding_discs" | "chainsaw";

export function getConsumablesByMode(mode: ConsumableMode): Consumable[] {
  switch (mode) {
    case "drill_bits": return DRILL_BITS;
    case "cutting_discs": return CUTTING_DISCS;
    case "grinding_discs": return GRINDING_DISCS;
    case "chainsaw": return CHAINSAW_CHAINS;
  }
}

export const CONSUMABLE_MODES: { id: ConsumableMode; label: string; icon: string; simType: string }[] = [
  { id: "drill_bits", label: "Свердла", icon: "🔩", simType: "drilling" },
  { id: "cutting_discs", label: "Відрізні диски", icon: "💿", simType: "cutting" },
  { id: "grinding_discs", label: "Шліфувальні диски", icon: "🔧", simType: "grinding" },
  { id: "chainsaw", label: "Бензопили", icon: "🪚", simType: "cutting" },
];
