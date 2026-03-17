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
  impactEnergyJ?: number; // Joules (for hammer drills / perforators)
  voltageV?: number;      // Voltage (for battery tools)
  isBrushless?: boolean;  // Brushless motor
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
  // Real DB slugs
  "dryli": "drill",
  "udarni-dryli": "hammer_drill",
  "perforatory": "hammer_drill",
  "pryami-perforatory": "hammer_drill",
  "bochkovi-perforatory": "hammer_drill",
  "kutovi-shlifmashyny-bolharky": "grinder",
  "shlifuval-ni-mashyny": "sander",
  "tsyrkulyarni-pyly": "circular_saw",
  "elektrolobzyky": "jigsaw",
  "elektropyly": "circular_saw",
  "elektrorubanky": "sander",
  "benzopyly": "circular_saw",
  "akumulyatorni-shurupoverty": "drill",
  "akumulyatorni-perforatory": "hammer_drill",
  "akumulyatorni-bolharky-kshm": "grinder",
  "akumulyatorni-tsyrkulyarni-pyly": "circular_saw",
  "akumulyatorni-shlifuval-ni-mashynky": "sander",
  "akumulyatorni-lobzyky": "jigsaw",
  "akumulyatorni-shabel-ni-pyly": "circular_saw",
  "akumulyatorni-lantsyuhovi-pylky": "circular_saw",
  // Legacy slugs (backwards compat)
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
  if (/шуруповерт/.test(lower)) return "drill";
  if (/болгарк|кутов\w+\s+шліф|ушм|angle\s*grinder|кшм/.test(lower)) return "grinder";
  // "Шліфмашина кутова" or "кутова шліфмашина" — both word orders = angle grinder
  if (/шліфмашин/.test(lower) && /кутов/.test(lower)) return "grinder";
  if (/шліфмашин|шліфувальн/.test(lower)) return "sander";
  if (/циркулярн|дисков\w+\s+пил|circular/.test(lower)) return "circular_saw";
  if (/бензопил|ланцюгов\w+\s+пил|електропил/.test(lower)) return "circular_saw";
  if (/лобзик|jigsaw/.test(lower)) return "jigsaw";
  if (/гайковерт|impact/.test(lower)) return "impact_wrench";
  if (/рубанок|рубан/.test(lower)) return "sander";
  return null;
}

function parseSpecsFromName(name: string): Partial<ToolSpecs> {
  const specs: Partial<ToolSpecs> = {};
  const text = name + " ";
  const lower = text.toLowerCase();

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

  // Disc diameter: "125мм", "230 мм" (only common disc sizes)
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

  // Impact energy: "3 Дж", "1.5Дж", "3J"
  const joulesMatch = text.match(/(\d+[.,]?\d*)\s*(?:Дж|дж|J)\b/);
  if (joulesMatch) {
    specs.impactEnergyJ = parseFloat(joulesMatch[1].replace(",", "."));
  }

  // Voltage: "20В", "20 В", "18В", "36V"
  const voltMatch = text.match(/(\d{2})\s*(?:В|V)\b/);
  if (voltMatch) {
    const v = parseInt(voltMatch[1]);
    if ([12, 14, 18, 20, 36, 40, 54].includes(v)) {
      specs.voltageV = v;
    }
  }

  // Brushless
  if (/безщітков|безщіточн|brushless|bl\b/i.test(lower)) {
    specs.isBrushless = true;
  }

  return specs;
}

/** Estimate power from Joules for hammer drills (perforators) */
function estimatePowerFromJoules(joules: number, isBrushless: boolean): number {
  // Rough heuristic: 1J ≈ 250-300W for corded, brushless more efficient
  const factor = isBrushless ? 350 : 280;
  return Math.round(joules * factor);
}

/** Estimate power from voltage for battery tools */
function estimatePowerFromVoltage(voltage: number, toolType: ToolType, isBrushless: boolean): number {
  // Rough: 20V battery ≈ 700-900W equivalent depending on tool type
  const base: Record<ToolType, number> = {
    drill: 35,
    hammer_drill: 40,
    grinder: 45,
    circular_saw: 55,
    jigsaw: 30,
    sander: 20,
    impact_wrench: 40,
  };
  const factor = base[toolType] || 35;
  const brushlessBoost = isBrushless ? 1.15 : 1.0;
  return Math.round(voltage * factor * brushlessBoost);
}

/** Estimate RPM from Joules for hammer drills */
function estimateRpmFromJoules(joules: number, isBrushless: boolean): number {
  // Higher joules = heavier tool = typically lower RPM for drilling
  // but higher impact rate
  const base = isBrushless ? 1800 : 1600;
  const rpm = base - (joules - 1.5) * 200;
  return Math.max(800, Math.min(3000, Math.round(rpm)));
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

  // Derive power from Joules or Voltage if not directly available
  let derivedPower: number | undefined;
  const isBrushless = parsed.isBrushless ?? false;

  if (!product.powerWatts && !parsed.powerWatts) {
    if (parsed.impactEnergyJ && (toolType === "hammer_drill")) {
      derivedPower = estimatePowerFromJoules(parsed.impactEnergyJ, isBrushless);
    } else if (parsed.voltageV) {
      derivedPower = estimatePowerFromVoltage(parsed.voltageV, toolType, isBrushless);
    }
  }

  // Derive RPM from Joules if available and RPM not specified
  let derivedRpm: number | undefined;
  if (!product.rpm && !parsed.rpm && parsed.impactEnergyJ && toolType === "hammer_drill") {
    derivedRpm = estimateRpmFromJoules(parsed.impactEnergyJ, isBrushless);
  }

  // Priority chain: DB fields > parsed from name > derived from specs > category defaults
  const specs: ToolSpecs = {
    toolType,
    isEstimated,
    powerWatts: product.powerWatts ?? parsed.powerWatts ?? derivedPower ?? defaults.powerWatts,
    rpm: product.rpm ?? parsed.rpm ?? derivedRpm ?? defaults.rpm,
    discDiameterMm: product.discDiameterMm ?? parsed.discDiameterMm ?? defaults.discDiameterMm,
    chuckMm: product.chuckMm ?? parsed.chuckMm ?? defaults.chuckMm,
    weightKg: product.weightKg ?? parsed.weightKg ?? defaults.weightKg,
    impactEnergyJ: parsed.impactEnergyJ,
    voltageV: parsed.voltageV,
    isBrushless,
  };

  // Brushless motors are slightly more efficient — boost power slightly
  if (isBrushless && !product.powerWatts && !parsed.powerWatts) {
    specs.powerWatts = Math.round(specs.powerWatts * 1.1);
  }

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
