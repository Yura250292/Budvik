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
  price?: number;
  image?: string | null;
}

export type ConsumableMode = "drill_bits" | "cutting_discs" | "grinding_discs" | "chainsaw";

export const CONSUMABLE_MODES: { id: ConsumableMode; label: string; icon: string; simType: string }[] = [
  { id: "drill_bits", label: "Свердла та бури", icon: "🔩", simType: "drilling" },
  { id: "cutting_discs", label: "Відрізні диски", icon: "💿", simType: "cutting" },
  { id: "grinding_discs", label: "Шліфувальні диски", icon: "🔧", simType: "grinding" },
  { id: "chainsaw", label: "Бензопили та ланцюги", icon: "🪚", simType: "cutting" },
];

// ============ BRAND QUALITY TIERS ============

interface BrandQuality {
  speedMod: number;       // multiplier on speed
  durabilityMod: number;  // multiplier on durability
  precisionMod: number;   // multiplier on precision
  heatMod: number;        // multiplier on heat (lower = better)
  tier: "premium" | "pro" | "standard" | "economy";
}

// Known brand tiers — based on market reputation
const BRAND_QUALITY: Record<string, BrandQuality> = {
  // Premium — найвища якість
  "bosch":      { speedMod: 1.15, durabilityMod: 1.25, precisionMod: 1.20, heatMod: 0.85, tier: "premium" },
  "makita":     { speedMod: 1.15, durabilityMod: 1.20, precisionMod: 1.15, heatMod: 0.85, tier: "premium" },
  "dewalt":     { speedMod: 1.18, durabilityMod: 1.20, precisionMod: 1.12, heatMod: 0.88, tier: "premium" },
  "hilti":      { speedMod: 1.20, durabilityMod: 1.30, precisionMod: 1.25, heatMod: 0.80, tier: "premium" },
  "metabo":     { speedMod: 1.12, durabilityMod: 1.22, precisionMod: 1.18, heatMod: 0.85, tier: "premium" },
  "milwaukee":  { speedMod: 1.15, durabilityMod: 1.22, precisionMod: 1.15, heatMod: 0.85, tier: "premium" },
  "festool":    { speedMod: 1.10, durabilityMod: 1.25, precisionMod: 1.30, heatMod: 0.82, tier: "premium" },
  "husqvarna":  { speedMod: 1.18, durabilityMod: 1.25, precisionMod: 1.15, heatMod: 0.85, tier: "premium" },
  "stihl":      { speedMod: 1.20, durabilityMod: 1.28, precisionMod: 1.15, heatMod: 0.82, tier: "premium" },
  "klingspor":  { speedMod: 1.15, durabilityMod: 1.25, precisionMod: 1.20, heatMod: 0.85, tier: "premium" },
  "norton":     { speedMod: 1.12, durabilityMod: 1.22, precisionMod: 1.18, heatMod: 0.88, tier: "premium" },
  "tyrolit":    { speedMod: 1.12, durabilityMod: 1.20, precisionMod: 1.18, heatMod: 0.88, tier: "premium" },
  "distar":     { speedMod: 1.15, durabilityMod: 1.22, precisionMod: 1.20, heatMod: 0.85, tier: "premium" },
  "3m":         { speedMod: 1.10, durabilityMod: 1.20, precisionMod: 1.25, heatMod: 0.88, tier: "premium" },
  "oregon":     { speedMod: 1.15, durabilityMod: 1.22, precisionMod: 1.15, heatMod: 0.88, tier: "premium" },

  // Pro — професійний рівень
  "dnipro-m":   { speedMod: 1.05, durabilityMod: 1.08, precisionMod: 1.05, heatMod: 0.95, tier: "pro" },
  "intertool":  { speedMod: 1.03, durabilityMod: 1.05, precisionMod: 1.03, heatMod: 0.97, tier: "pro" },
  "haisser":    { speedMod: 1.05, durabilityMod: 1.10, precisionMod: 1.05, heatMod: 0.95, tier: "pro" },
  "stanley":    { speedMod: 1.08, durabilityMod: 1.10, precisionMod: 1.08, heatMod: 0.92, tier: "pro" },
  "graphite":   { speedMod: 1.05, durabilityMod: 1.08, precisionMod: 1.05, heatMod: 0.95, tier: "pro" },
  "total":      { speedMod: 1.02, durabilityMod: 1.05, precisionMod: 1.02, heatMod: 0.98, tier: "pro" },
  "patron":     { speedMod: 1.05, durabilityMod: 1.08, precisionMod: 1.05, heatMod: 0.95, tier: "pro" },
  "granite":    { speedMod: 1.05, durabilityMod: 1.10, precisionMod: 1.05, heatMod: 0.93, tier: "pro" },
  "sprut":      { speedMod: 1.03, durabilityMod: 1.05, precisionMod: 1.02, heatMod: 0.97, tier: "pro" },
  "werk":       { speedMod: 1.03, durabilityMod: 1.05, precisionMod: 1.03, heatMod: 0.97, tier: "pro" },

  // Standard — стандартна якість
  "apro":       { speedMod: 1.0, durabilityMod: 1.0, precisionMod: 1.0, heatMod: 1.0, tier: "standard" },
  "sigma":      { speedMod: 1.0, durabilityMod: 1.0, precisionMod: 1.0, heatMod: 1.0, tier: "standard" },
  "grad":       { speedMod: 1.0, durabilityMod: 1.0, precisionMod: 1.0, heatMod: 1.0, tier: "standard" },
  "mastertool": { speedMod: 0.98, durabilityMod: 0.95, precisionMod: 0.98, heatMod: 1.02, tier: "standard" },
  "housetools": { speedMod: 0.98, durabilityMod: 0.95, precisionMod: 0.97, heatMod: 1.03, tier: "standard" },
  "vita":       { speedMod: 0.98, durabilityMod: 0.95, precisionMod: 0.98, heatMod: 1.02, tier: "standard" },

  // Economy — бюджетний рівень
  "greatflex":  { speedMod: 0.92, durabilityMod: 0.80, precisionMod: 0.90, heatMod: 1.10, tier: "economy" },
  "luga":       { speedMod: 0.90, durabilityMod: 0.78, precisionMod: 0.88, heatMod: 1.12, tier: "economy" },
};

/** Extract brand from product name */
function detectBrand(name: string): BrandQuality {
  const lower = name.toLowerCase();

  // Check each brand — try longest names first to avoid false matches
  const sortedBrands = Object.entries(BRAND_QUALITY).sort((a, b) => b[0].length - a[0].length);

  for (const [brand, quality] of sortedBrands) {
    // Match brand at start, after space, or after certain chars
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?:^|\\s|\\()${escaped}(?:\\s|$|\\)|\\b)`, "i").test(lower)) {
      return quality;
    }
  }

  // Fallback: standard quality
  return { speedMod: 1.0, durabilityMod: 1.0, precisionMod: 1.0, heatMod: 1.0, tier: "standard" };
}

/** Price-based quality estimation when brand is unknown */
function priceQualityFactor(price: number | null | undefined, mode: ConsumableMode): BrandQuality {
  if (!price || price <= 0) return { speedMod: 1.0, durabilityMod: 1.0, precisionMod: 1.0, heatMod: 1.0, tier: "standard" };

  // Average price ranges per mode (in UAH)
  const avgPrices: Record<ConsumableMode, { low: number; mid: number; high: number }> = {
    cutting_discs:  { low: 15, mid: 35, high: 80 },
    grinding_discs: { low: 25, mid: 60, high: 150 },
    drill_bits:     { low: 30, mid: 80, high: 250 },
    chainsaw:       { low: 150, mid: 400, high: 1500 },
  };

  const range = avgPrices[mode];
  if (price >= range.high) return { speedMod: 1.10, durabilityMod: 1.15, precisionMod: 1.10, heatMod: 0.90, tier: "pro" };
  if (price >= range.mid) return { speedMod: 1.03, durabilityMod: 1.05, precisionMod: 1.03, heatMod: 0.97, tier: "pro" };
  if (price <= range.low) return { speedMod: 0.93, durabilityMod: 0.85, precisionMod: 0.92, heatMod: 1.08, tier: "economy" };

  return { speedMod: 1.0, durabilityMod: 1.0, precisionMod: 1.0, heatMod: 1.0, tier: "standard" };
}

// ============ PRODUCT → CONSUMABLE PARSER ============

interface ProductInput {
  id: string;
  name: string;
  price?: number | null;
  image?: string | null;
  category?: { slug?: string; name?: string } | null;
}

/** Parse diameter from product name (e.g., "125x1.0", "Ø125", "125мм", "125 мм") */
function parseDiameter(name: string): number | undefined {
  // Pattern: 125x1.0 or 125×1.0 — first number is diameter
  const crossMatch = name.match(/(\d{2,3})\s*[x×]\s*\d/i);
  if (crossMatch) return parseInt(crossMatch[1]);

  // Pattern: Ø125 or Ø 125
  const oMatch = name.match(/[Øø]\s*(\d{2,3})/);
  if (oMatch) return parseInt(oMatch[1]);

  // Pattern: "125 мм" or "125мм" (standalone, not part of thickness)
  const mmMatch = name.match(/\b(\d{2,3})\s*мм\b/);
  if (mmMatch) return parseInt(mmMatch[1]);

  return undefined;
}

/** Parse thickness from product name (e.g., "125x1.0", "125×1.6") */
function parseThickness(name: string): number | undefined {
  const crossMatch = name.match(/\d{2,3}\s*[x×]\s*(\d+[.,]\d+)/i);
  if (crossMatch) return parseFloat(crossMatch[1].replace(",", "."));

  // Thickness pattern like "6.0мм" for grinding discs
  const thickMatch = name.match(/[x×]\s*(\d+[.,]\d+)\s*[x×]/i);
  if (thickMatch) return parseFloat(thickMatch[1].replace(",", "."));

  return undefined;
}

/** Parse grit from product name (e.g., "P60", "P120", "P36") */
function parseGrit(name: string): number | undefined {
  const gritMatch = name.match(/[PР](\d{2,3})\b/);
  if (gritMatch) return parseInt(gritMatch[1]);
  return undefined;
}

/** Parse drill diameter from name (e.g., "6×160", "Ø10", "12мм") */
function parseDrillDiameter(name: string): number | undefined {
  // SDS drill pattern: "S4 12×260" — first number is diameter
  const sdsMatch = name.match(/S\d\s+(\d+)\s*[x×]/i);
  if (sdsMatch) return parseInt(sdsMatch[1]);

  // Pattern: Ø10 or Ø 10
  const oMatch = name.match(/[Øø]\s*(\d{1,2})\b/);
  if (oMatch) return parseInt(oMatch[1]);

  // Generic: first number before "x" or "мм"
  const match = name.match(/\b(\d{1,2})\s*[x×]\s*\d/);
  if (match) return parseInt(match[1]);

  const mmMatch = name.match(/\b(\d{1,2})\s*мм\b/);
  if (mmMatch) return parseInt(mmMatch[1]);

  return undefined;
}

/** Detect material target from product name/category */
function detectMaterialTarget(name: string, categorySlug?: string): "metal" | "stone" | "wood" | "universal" | "diamond" {
  const n = name.toLowerCase();
  const slug = categorySlug?.toLowerCase() || "";

  if (n.includes("алмазн") || n.includes("diamond")) return "diamond";
  if (n.includes("по дереву") || n.includes("дерев") || slug.includes("derevu")) return "wood";
  if (n.includes("по бетону") || n.includes("камен") || n.includes("каменю") || n.includes("бетон") || slug.includes("betonu")) return "stone";
  if (n.includes("по метал") || n.includes("для метал") || slug.includes("metalu")) return "metal";
  if (n.includes("кераміка") || n.includes("плитк") || n.includes("скл")) return "diamond";

  return "universal";
}

function getMaterialCompat(target: "metal" | "stone" | "wood" | "universal" | "diamond"): Record<string, number> {
  switch (target) {
    case "metal":
      return { mild_steel: 2, stainless: 1, aluminum: 2, wood_soft: 0, wood_hard: 0, concrete: 0, brick: 0, tile: 0 };
    case "stone":
      return { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 };
    case "wood":
      return { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 };
    case "diamond":
      return { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 2 };
    case "universal":
      return { mild_steel: 1, stainless: 1, aluminum: 1, wood_soft: 1, wood_hard: 1, concrete: 1, brick: 1, tile: 1 };
  }
}

/** Convert a real product from DB into a Consumable with heuristic simulation factors */
export function productToConsumable(product: ProductInput, mode: ConsumableMode): Consumable {
  const name = product.name;
  const slug = product.category?.slug || "";
  const target = detectMaterialTarget(name, slug);
  const materialCompat = getMaterialCompat(target);

  let consumable: Consumable;
  switch (mode) {
    case "cutting_discs":
      consumable = parseCuttingDisc(product, target, materialCompat);
      break;
    case "grinding_discs":
      consumable = parseGrindingDisc(product, target, materialCompat);
      break;
    case "drill_bits":
      consumable = parseDrillBit(product, target, materialCompat);
      break;
    case "chainsaw":
      consumable = parseChainsawProduct(product, materialCompat);
      break;
  }

  // Apply brand quality modifiers
  const brand = detectBrand(name);
  // If brand is standard (unknown), try price-based estimation
  const quality = brand.tier === "standard" ? priceQualityFactor(product.price, mode) : brand;

  // Only apply if not standard (to avoid double-neutral)
  if (quality.tier !== "standard") {
    consumable.speedFactor = round2(consumable.speedFactor * quality.speedMod);
    consumable.durabilityFactor = round2(consumable.durabilityFactor * quality.durabilityMod);
    consumable.precisionFactor = round2(consumable.precisionFactor * quality.precisionMod);
    consumable.heatFactor = round2(consumable.heatFactor * quality.heatMod);

    const tierLabels: Record<string, string> = {
      premium: "Преміум якість",
      pro: "Професійна якість",
      economy: "Бюджетна якість",
    };
    consumable.description += ` | ${tierLabels[quality.tier] || ""}`;
  }

  return consumable;
}

function parseCuttingDisc(product: ProductInput, target: string, materialCompat: Record<string, number>): Consumable {
  const name = product.name;
  const diameter = parseDiameter(name);
  const thickness = parseThickness(name);
  const n = name.toLowerCase();

  // Base factors — derived from disc characteristics
  let speedFactor = 1.0;
  let durabilityFactor = 1.0;
  let precisionFactor = 1.0;
  let heatFactor = 1.0;
  let description = "";

  if (target === "diamond") {
    speedFactor = 1.4;
    durabilityFactor = 2.0;
    precisionFactor = 1.5;
    heatFactor = 0.6;
    description = "Алмазний диск — висока швидкість і довговічність";

    if (n.includes("турбо") || n.includes("turbo")) {
      speedFactor = 1.6;
      precisionFactor = 1.0;
      heatFactor = 0.7;
      description = "Алмазний турбо — максимальна швидкість різу";
    }
    if (n.includes("ультра") || n.includes("ultra")) {
      speedFactor = 1.5;
      precisionFactor = 1.8;
      heatFactor = 0.5;
      description = "Ультратонкий алмазний — точний чистий різ";
    }
    if (n.includes("кераміка") || n.includes("ceramic")) {
      precisionFactor = 1.7;
      description = "Алмазний по кераміці — ідеальна точність";
    }
    if (n.includes("швидкий різ")) {
      speedFactor = 1.7;
      durabilityFactor = 1.5;
      description = "Алмазний Швидкий Різ — агресивне різання";
    }
  } else if (thickness) {
    // Abrasive disc — factors depend on thickness
    if (thickness <= 1.0) {
      speedFactor = 1.3;
      durabilityFactor = 0.6;
      precisionFactor = 1.3;
      heatFactor = 0.8;
      description = "Тонкий диск — швидкий різ, менше нагрів";
    } else if (thickness <= 1.2) {
      speedFactor = 1.2;
      durabilityFactor = 0.7;
      precisionFactor = 1.2;
      heatFactor = 0.85;
      description = "Тонкий диск — баланс швидкості та точності";
    } else if (thickness <= 1.6) {
      speedFactor = 1.0;
      durabilityFactor = 1.0;
      precisionFactor = 1.0;
      heatFactor = 1.0;
      description = "Стандартний відрізний диск";
    } else if (thickness <= 2.0) {
      speedFactor = 0.85;
      durabilityFactor = 1.3;
      precisionFactor = 0.85;
      heatFactor = 1.15;
      description = "Посилений диск — вища довговічність";
    } else if (thickness <= 2.5) {
      speedFactor = 0.7;
      durabilityFactor = 1.6;
      precisionFactor = 0.7;
      heatFactor = 1.3;
      description = "Товстий диск — дуже довговічний";
    } else {
      speedFactor = 0.6;
      durabilityFactor = 2.0;
      precisionFactor = 0.5;
      heatFactor = 1.5;
      description = "Масивний диск — максимальна довговічність";
    }
  } else {
    description = "Відрізний диск";
  }

  // Diameter factor — larger discs are slightly slower but more durable
  if (diameter && diameter > 125) {
    const diamFactor = diameter / 125;
    speedFactor *= 0.95;
    durabilityFactor *= Math.min(diamFactor * 0.9, 1.5);
  }

  return {
    id: product.id,
    nameUk: product.name,
    category: "cutting_disc",
    diameterMm: diameter,
    thicknessMm: thickness,
    speedFactor: round2(speedFactor),
    durabilityFactor: round2(durabilityFactor),
    precisionFactor: round2(precisionFactor),
    heatFactor: round2(heatFactor),
    materialCompat,
    description,
    price: product.price ?? undefined,
    image: product.image,
  };
}

function parseGrindingDisc(product: ProductInput, target: string, materialCompat: Record<string, number>): Consumable {
  const name = product.name;
  const diameter = parseDiameter(name);
  const thickness = parseThickness(name);
  const grit = parseGrit(name);
  const n = name.toLowerCase();

  let speedFactor = 1.0;
  let durabilityFactor = 1.0;
  let precisionFactor = 1.0;
  let heatFactor = 1.0;
  let description = "";

  const isPelyustkoviy = n.includes("пелюстков") || n.includes("flap");
  const isZachysniy = n.includes("зачисн") || n.includes("шліфувальн");
  const isFibroviy = n.includes("фібров") || n.includes("fiber");
  const isKoral = n.includes("корал") || n.includes("nylon");

  if (isPelyustkoviy && grit) {
    // Flap disc — grit determines factors
    if (grit <= 40) {
      speedFactor = 1.2; durabilityFactor = 0.8; precisionFactor = 0.6; heatFactor = 1.1;
      description = `Пелюстковий P${grit} — грубе зняття матеріалу`;
    } else if (grit <= 80) {
      speedFactor = 0.9; durabilityFactor = 1.2; precisionFactor = 1.2; heatFactor = 0.8;
      description = `Пелюстковий P${grit} — чистіша поверхня`;
    } else if (grit <= 120) {
      speedFactor = 0.6; durabilityFactor = 1.4; precisionFactor = 1.6; heatFactor = 0.6;
      description = `Пелюстковий P${grit} — фінішна обробка`;
    } else {
      speedFactor = 0.4; durabilityFactor = 1.5; precisionFactor = 1.8; heatFactor = 0.5;
      description = `Пелюстковий P${grit} — дуже гладка поверхня`;
    }
    // Flap discs are universal
    materialCompat = { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 };
  } else if (isZachysniy) {
    speedFactor = 1.0; durabilityFactor = 1.0; precisionFactor = 0.8; heatFactor = 1.0;
    description = "Зачисний диск — зняття нерівностей і зварних швів";
  } else if (isFibroviy) {
    speedFactor = 1.3; durabilityFactor = 0.7; precisionFactor = 0.6; heatFactor = 1.2;
    description = "Фібровий диск — агресивне зняття матеріалу";
  } else if (isKoral) {
    speedFactor = 0.8; durabilityFactor = 1.0; precisionFactor = 1.3; heatFactor = 0.6;
    description = "Корал-диск — зняття фарби та іржі без нагріву";
    materialCompat = { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 };
  } else if (n.includes("чаша") || n.includes("cup")) {
    speedFactor = 0.9; durabilityFactor = 1.5; precisionFactor = 0.7; heatFactor = 1.1;
    description = "Алмазна чаша — шліфування бетонних поверхонь";
    materialCompat = { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 };
  } else {
    description = "Шліфувальний диск";
  }

  // Conical (Т29) vs flat (Т27)
  if (n.includes("т29") || n.includes("t29") || n.includes("конічн")) {
    speedFactor *= 1.05;
    precisionFactor *= 1.05;
  }

  return {
    id: product.id,
    nameUk: product.name,
    category: "grinding_disc",
    diameterMm: diameter,
    thicknessMm: thickness,
    speedFactor: round2(speedFactor),
    durabilityFactor: round2(durabilityFactor),
    precisionFactor: round2(precisionFactor),
    heatFactor: round2(heatFactor),
    materialCompat,
    description,
    price: product.price ?? undefined,
    image: product.image,
  };
}

function parseDrillBit(product: ProductInput, target: string, materialCompat: Record<string, number>): Consumable {
  const name = product.name;
  const diameter = parseDrillDiameter(name);
  const n = name.toLowerCase();

  let speedFactor = 1.0;
  let durabilityFactor = 1.0;
  let precisionFactor = 1.0;
  let heatFactor = 1.0;
  let description = "";

  const isSDS = n.includes("sds");
  const isBur = n.includes("бур");
  const isSpiral = n.includes("спіральн") || n.includes("spiral");
  const isPero = n.includes("перо") || n.includes("перов");
  const isForstner = n.includes("форстнер") || n.includes("forstner");
  const isSkhidchast = n.includes("східчаст") || n.includes("step");
  const isKoronka = n.includes("коронка") || n.includes("коронк");
  const isTrubchast = n.includes("трубчаст");
  const isCobalt = n.includes("кобальт") || n.includes("cobalt") || n.includes("hss-co");
  const isHSS = n.includes("hss") && !isCobalt;
  const isNabir = n.includes("набір") || n.includes("набор") || n.includes("комплект");

  if (isSDS || isBur) {
    speedFactor = 1.3; durabilityFactor = 1.2; precisionFactor = 0.7; heatFactor = 0.9;
    description = "Бур SDS — для перфоратора по бетону";
    materialCompat = { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 0, wood_hard: 0, concrete: 2, brick: 2, tile: 1 };
  } else if (isKoronka) {
    speedFactor = 0.6; durabilityFactor = 1.3; precisionFactor = 1.5; heatFactor = 1.1;
    description = "Коронка — великі отвори з чистим краєм";
    if (target === "diamond") {
      speedFactor = 0.8; durabilityFactor = 2.0; heatFactor = 0.7;
      description = "Алмазна коронка — для плитки та скла";
    }
  } else if (isPero) {
    speedFactor = 1.5; durabilityFactor = 0.6; precisionFactor = 0.5; heatFactor = 0.6;
    description = "Перо по дереву — швидкий, але грубий отвір";
  } else if (isForstner) {
    speedFactor = 0.7; durabilityFactor = 1.0; precisionFactor = 1.8; heatFactor = 0.8;
    description = "Форстнера — ідеально чистий отвір у дереві";
  } else if (isSkhidchast) {
    speedFactor = 0.8; durabilityFactor = 1.2; precisionFactor = 1.0; heatFactor = 0.9;
    description = "Східчасте свердло — різні діаметри одним свердлом";
  } else if (isTrubchast) {
    speedFactor = 0.7; durabilityFactor = 1.5; precisionFactor = 1.3; heatFactor = 0.8;
    description = "Трубчасте з алмазним напиленням";
  } else if (isCobalt) {
    speedFactor = 1.2; durabilityFactor = 1.5; precisionFactor = 1.2; heatFactor = 0.7;
    description = "Кобальтове — для нержавіючої сталі та твердих металів";
    materialCompat = { mild_steel: 2, stainless: 2, aluminum: 2, wood_soft: 1, wood_hard: 1, concrete: 0, brick: 0, tile: 0 };
  } else if (isHSS) {
    speedFactor = 1.0; durabilityFactor = 0.8; precisionFactor = 1.0; heatFactor = 1.0;
    description = "HSS свердло — стандартне по металу";
  } else if (isNabir) {
    speedFactor = 1.0; durabilityFactor = 1.0; precisionFactor = 1.0; heatFactor = 1.0;
    description = "Набір свердел — різні розміри";
  } else if (target === "stone") {
    speedFactor = 1.1; durabilityFactor = 1.0; precisionFactor = 0.8; heatFactor = 1.0;
    description = "Свердло по бетону з твердосплавним наконечником";
  } else if (target === "wood") {
    speedFactor = 1.2; durabilityFactor = 0.9; precisionFactor = 1.1; heatFactor = 0.7;
    description = "Свердло по дереву";
  } else {
    description = "Свердло";
  }

  // Larger diameter drills are slower but need more power
  if (diameter && diameter > 10) {
    speedFactor *= Math.max(0.6, 1 - (diameter - 10) * 0.02);
    heatFactor *= Math.min(1.5, 1 + (diameter - 10) * 0.02);
  }

  return {
    id: product.id,
    nameUk: product.name,
    category: "drill_bit",
    diameterMm: diameter,
    speedFactor: round2(speedFactor),
    durabilityFactor: round2(durabilityFactor),
    precisionFactor: round2(precisionFactor),
    heatFactor: round2(heatFactor),
    materialCompat,
    description,
    price: product.price ?? undefined,
    image: product.image,
  };
}

function parseChainsawProduct(product: ProductInput, materialCompat: Record<string, number>): Consumable {
  const name = product.name;
  const n = name.toLowerCase();

  let speedFactor = 1.0;
  let durabilityFactor = 1.0;
  let precisionFactor = 1.0;
  let heatFactor = 1.0;
  let description = "";

  const isBenzopyla = n.includes("бензопил") || n.includes("chainsaw");
  const isElektropyla = n.includes("електропил") || n.includes("акумулятор");
  const isLantsyuh = n.includes("ланцюг") || n.includes("chain");
  const isNabir = n.includes("набір") || n.includes("набор");

  if (isLantsyuh) {
    // Parse chain type
    const is325 = n.includes("0,325") || n.includes("0.325") || n.includes(".325");
    const is38 = n.includes("3/8");
    const isSemiChisel = n.includes("напівчізель") || n.includes("semi") || n.includes("напівч");
    const isChisel = !isSemiChisel && (n.includes("чізель") || n.includes("chisel"));

    // Parse link count for size estimation
    const linkMatch = n.match(/(\d{2})\s*(?:ланок|ланки|DL|звен)/i);
    const links = linkMatch ? parseInt(linkMatch[1]) : null;

    if (is38) {
      speedFactor = 1.3; durabilityFactor = 0.9; precisionFactor = 0.8; heatFactor = 1.1;
      description = "Ланцюг 3/8\" — для потужних пил, швидший різ";
    } else if (is325) {
      speedFactor = 1.0; durabilityFactor = 1.1; precisionFactor = 1.0; heatFactor = 1.0;
      description = "Ланцюг .325\" — універсальний баланс";
    } else {
      speedFactor = 1.0; durabilityFactor = 1.0; precisionFactor = 1.0; heatFactor = 1.0;
      description = "Ланцюг для пили";
    }

    if (isSemiChisel) {
      speedFactor *= 0.9; durabilityFactor *= 1.3; heatFactor *= 0.9;
      description += " (напівчізель — довго тримає заточку)";
    } else if (isChisel) {
      speedFactor *= 1.3; durabilityFactor *= 0.7;
      description += " (чізель — максимальна швидкість)";
    }

    if (isNabir) {
      durabilityFactor *= 1.2;
      description = "Набір ланцюгів + шина";
    }

    // Longer chains slightly slower
    if (links && links > 60) {
      speedFactor *= 0.95;
      durabilityFactor *= 1.05;
    }
  } else if (isBenzopyla) {
    // Parse power from name
    const powerMatch = n.match(/(\d{1,2}[.,]\d)\s*к[Вв]т/);
    const ccMatch = n.match(/(\d{2,3})\s*(?:см³|cc|куб)/i);

    speedFactor = 1.0; durabilityFactor = 1.0;

    if (powerMatch) {
      const kw = parseFloat(powerMatch[1].replace(",", "."));
      speedFactor = Math.min(2.0, kw / 1.8);
      durabilityFactor = Math.min(1.5, kw / 2.0);
    }
    if (ccMatch) {
      const cc = parseInt(ccMatch[1]);
      speedFactor = Math.min(2.0, cc / 45);
      durabilityFactor = Math.min(1.5, cc / 50);
    }

    precisionFactor = 0.9;
    heatFactor = 0.8;
    description = "Бензопила — для пиляння колод та дерев";
  } else if (isElektropyla) {
    speedFactor = 0.8; durabilityFactor = 1.1; precisionFactor = 1.0; heatFactor = 0.7;
    description = "Електропила — тихіша, для домашнього використання";
  } else {
    description = "Пиляльний інструмент";
  }

  // Chainsaws always for wood
  const woodCompat = { mild_steel: 0, stainless: 0, aluminum: 0, wood_soft: 2, wood_hard: 2, concrete: 0, brick: 0, tile: 0 };

  return {
    id: product.id,
    nameUk: product.name,
    category: "chainsaw_chain",
    speedFactor: round2(speedFactor),
    durabilityFactor: round2(durabilityFactor),
    precisionFactor: round2(precisionFactor),
    heatFactor: round2(heatFactor),
    materialCompat: woodCompat,
    description,
    price: product.price ?? undefined,
    image: product.image,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
