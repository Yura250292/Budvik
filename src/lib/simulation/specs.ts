export type ToolType =
  | "drill"
  | "hammer_drill"
  | "grinder"
  | "circular_saw"
  | "jigsaw"
  | "sander"
  | "impact_wrench";

export interface ToolSpecs {
  powerWatts: number;
  rpm: number;
  discDiameterMm: number | null;
  chuckMm: number | null;
  weightKg: number;
  toolType: ToolType;
  isEstimated: boolean; // true if specs were inferred, not from DB
}

interface ProductInput {
  name: string;
  description?: string | null;
  powerWatts?: number | null;
  rpm?: number | null;
  discDiameterMm?: number | null;
  chuckMm?: number | null;
  toolType?: string | null;
  weightKg?: number | null;
  category?: { slug: string; name: string } | null;
}

const CATEGORY_DEFAULTS: Record<ToolType, Omit<ToolSpecs, "toolType" | "isEstimated">> = {
  drill: { powerWatts: 750, rpm: 2800, discDiameterMm: null, chuckMm: 13, weightKg: 2.1 },
  hammer_drill: { powerWatts: 900, rpm: 2500, discDiameterMm: null, chuckMm: 13, weightKg: 3.0 },
  grinder: { powerWatts: 900, rpm: 11000, discDiameterMm: 125, chuckMm: null, weightKg: 2.3 },
  circular_saw: { powerWatts: 1400, rpm: 5000, discDiameterMm: 185, chuckMm: null, weightKg: 4.5 },
  jigsaw: { powerWatts: 650, rpm: 3000, discDiameterMm: null, chuckMm: null, weightKg: 2.0 },
  sander: { powerWatts: 300, rpm: 12000, discDiameterMm: 125, chuckMm: null, weightKg: 1.8 },
  impact_wrench: { powerWatts: 800, rpm: 3200, discDiameterMm: null, chuckMm: null, weightKg: 2.5 },
};

const CATEGORY_SLUG_MAP: Record<string, ToolType> = {
  "drili-ta-perforatory": "drill",
  "shlifuvalni-mashyny": "grinder",
  "pylky-ta-lobzyky": "circular_saw",
  "akumulyatornyy-instrument": "drill",
};

function inferToolTypeFromName(name: string): ToolType | null {
  const lower = name.toLowerCase();
  if (/перфоратор/.test(lower)) return "hammer_drill";
  if (/дриль\s+удар/.test(lower) || /ударн\w+\s+дриль/.test(lower)) return "hammer_drill";
  if (/дриль|дрель|свердл/.test(lower)) return "drill";
  if (/болгарк|кутов\w+\s+шліф|ушм|angle\s*grinder/.test(lower)) return "grinder";
  if (/шліфмашин|шліфувальн/.test(lower)) return "sander";
  if (/циркулярн|дисков\w+\s+пил|circular/.test(lower)) return "circular_saw";
  if (/лобзик|jigsaw/.test(lower)) return "jigsaw";
  if (/гайковерт|impact/.test(lower)) return "impact_wrench";
  return null;
}

function parseSpecsFromName(name: string): Partial<ToolSpecs> {
  const specs: Partial<ToolSpecs> = {};
  const text = name + " ";

  // Power: "850Вт", "850 Вт", "850W", "1.2кВт"
  const kwMatch = text.match(/(\d+[.,]\d+)\s*кВт/i);
  if (kwMatch) {
    specs.powerWatts = Math.round(parseFloat(kwMatch[1].replace(",", ".")) * 1000);
  } else {
    const wMatch = text.match(/(\d{3,4})\s*(?:Вт|W)/i);
    if (wMatch) specs.powerWatts = parseInt(wMatch[1]);
  }

  // RPM: "2800об/хв", "11000rpm", "2800 об/хв"
  const rpmMatch = text.match(/(\d{3,5})\s*(?:об\/хв|об\.\/хв|rpm)/i);
  if (rpmMatch) specs.rpm = parseInt(rpmMatch[1]);

  // Disc diameter: "125мм", "230 мм"
  const discMatch = text.match(/(\d{2,3})\s*мм/i);
  if (discMatch) {
    const val = parseInt(discMatch[1]);
    if ([115, 125, 150, 180, 230].includes(val)) {
      specs.discDiameterMm = val;
    }
  }

  // Chuck: "13мм патрон", "патрон 10мм"
  const chuckMatch = text.match(/(?:патрон|chuck)\s*(\d{1,2})\s*мм/i)
    || text.match(/(\d{1,2})\s*мм\s*(?:патрон|chuck)/i);
  if (chuckMatch) specs.chuckMm = parseFloat(chuckMatch[1]);

  // Weight: "2.5кг", "2,5 кг"
  const weightMatch = text.match(/(\d+[.,]\d+)\s*кг/i);
  if (weightMatch) specs.weightKg = parseFloat(weightMatch[1].replace(",", "."));

  return specs;
}

export function resolveSpecs(product: ProductInput): ToolSpecs {
  // Step 1: Determine tool type
  let toolType: ToolType;
  let isEstimated = false;

  if (product.toolType && product.toolType in CATEGORY_DEFAULTS) {
    toolType = product.toolType as ToolType;
  } else {
    const fromName = inferToolTypeFromName(product.name);
    if (fromName) {
      toolType = fromName;
    } else if (product.category?.slug && product.category.slug in CATEGORY_SLUG_MAP) {
      toolType = CATEGORY_SLUG_MAP[product.category.slug];
    } else {
      toolType = "grinder"; // fallback
    }
    isEstimated = true;
  }

  const defaults = CATEGORY_DEFAULTS[toolType];
  const parsed = parseSpecsFromName(product.name);

  // Priority chain: DB fields > parsed from name > category defaults
  const specs: ToolSpecs = {
    toolType,
    isEstimated,
    powerWatts: product.powerWatts ?? parsed.powerWatts ?? defaults.powerWatts,
    rpm: product.rpm ?? parsed.rpm ?? defaults.rpm,
    discDiameterMm: product.discDiameterMm ?? parsed.discDiameterMm ?? defaults.discDiameterMm,
    chuckMm: product.chuckMm ?? parsed.chuckMm ?? defaults.chuckMm,
    weightKg: product.weightKg ?? parsed.weightKg ?? defaults.weightKg,
  };

  // If any DB field was used, mark as not fully estimated
  if (product.powerWatts || product.rpm || product.discDiameterMm || product.toolType) {
    specs.isEstimated = false;
  }

  return specs;
}

export type SimulationType = "cutting" | "grinding" | "drilling";

const TOOL_TYPE_CAPABILITIES: Record<ToolType, SimulationType[]> = {
  grinder: ["cutting", "grinding"],
  sander: ["grinding"],
  drill: ["drilling"],
  hammer_drill: ["drilling"],
  circular_saw: ["cutting"],
  jigsaw: ["cutting"],
  impact_wrench: [],
};

export function getCompatibleSimulations(toolType: ToolType): SimulationType[] {
  return TOOL_TYPE_CAPABILITIES[toolType] || [];
}

export function isCompatible(toolType: ToolType, simType: SimulationType): boolean {
  return TOOL_TYPE_CAPABILITIES[toolType]?.includes(simType) ?? false;
}
