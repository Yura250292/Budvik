export type ToolType =
  | "drill"
  | "hammer_drill"
  | "grinder"
  | "circular_saw"
  | "chainsaw"
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
  isEstimated: boolean;
  impactEnergyJ?: number;
  voltageV?: number;
  isBrushless?: boolean;
  barLengthCm?: number; // chainsaw bar length
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
  drill:        { powerWatts: 750,  rpm: 2800,  discDiameterMm: null, chuckMm: 13,   weightKg: 2.1 },
  hammer_drill: { powerWatts: 900,  rpm: 2500,  discDiameterMm: null, chuckMm: 13,   weightKg: 3.0 },
  grinder:      { powerWatts: 900,  rpm: 11000, discDiameterMm: 125,  chuckMm: null, weightKg: 2.3 },
  circular_saw: { powerWatts: 1400, rpm: 5000,  discDiameterMm: 185,  chuckMm: null, weightKg: 4.5 },
  chainsaw:     { powerWatts: 1600, rpm: 9500,  discDiameterMm: null, chuckMm: null, weightKg: 4.2, barLengthCm: 35 },
  jigsaw:       { powerWatts: 650,  rpm: 3000,  discDiameterMm: null, chuckMm: null, weightKg: 2.0 },
  sander:       { powerWatts: 300,  rpm: 12000, discDiameterMm: 125,  chuckMm: null, weightKg: 1.8 },
  impact_wrench:{ powerWatts: 800,  rpm: 3200,  discDiameterMm: null, chuckMm: null, weightKg: 2.5 },
};

const CATEGORY_SLUG_MAP: Record<string, ToolType> = {
  // Drills
  "dryli": "drill",
  "udarni-dryli": "hammer_drill",
  "perforatory": "hammer_drill",
  "pryami-perforatory": "hammer_drill",
  "bochkovi-perforatory": "hammer_drill",
  "akumulyatorni-shurupoverty": "drill",
  "akumulyatorni-perforatory": "hammer_drill",
  // Grinders
  "kutovi-shlifmashyny-bolharky": "grinder",
  "akumulyatorni-bolharky-kshm": "grinder",
  // Sanders
  "shlifuval-ni-mashyny": "sander",
  "akumulyatorni-shlifuval-ni-mashynky": "sander",
  "elektrorubanky": "sander",
  // Circular saws (non-chainsaw)
  "tsyrkulyarni-pyly": "circular_saw",
  "akumulyatorni-tsyrkulyarni-pyly": "circular_saw",
  // Chainsaws
  "elektropyly": "chainsaw",
  "benzopyly": "chainsaw",
  "akumulyatorni-lantsyuhovi-pylky": "chainsaw",
  "lantsyuhovi-pylky": "chainsaw",
  "akumulyatorni-shabel-ni-pyly": "chainsaw",
  // Jigsaws
  "elektrolobzyky": "jigsaw",
  "akumulyatorni-lobzyky": "jigsaw",
  // Legacy
  "drili-ta-perforatory": "drill",
  "shlifuvalni-mashyny": "grinder",
  "pylky-ta-lobzyky": "jigsaw",
  "akumulyatornyy-instrument": "drill",
};

function inferToolTypeFromName(name: string): ToolType | null {
  const lower = name.toLowerCase();
  if (/перфоратор/.test(lower)) return "hammer_drill";
  if (/дриль\s+удар/.test(lower) || /ударн\w+\s+дриль/.test(lower)) return "hammer_drill";
  if (/дриль|дрель|свердл/.test(lower)) return "drill";
  if (/шуруповерт/.test(lower)) return "drill";
  if (/болгарк|кутов\w+\s+шліф|ушм|angle\s*grinder|кшм/.test(lower)) return "grinder";
  if (/шліфмашин/.test(lower) && /кутов/.test(lower)) return "grinder";
  if (/шліфмашин|шліфувальн/.test(lower)) return "sander";
  if (/циркулярн|дисков\w+\s+пил|circular/.test(lower)) return "circular_saw";
  // Chainsaws — detected BEFORE generic "пила" patterns
  if (/бензопил|ланцюгов\w+\s+пил|електропил/.test(lower)) return "chainsaw";
  if (/лобзик|jigsaw/.test(lower)) return "jigsaw";
  if (/гайковерт|impact/.test(lower)) return "impact_wrench";
  if (/рубанок|рубан/.test(lower)) return "sander";
  return null;
}

function parseSpecsFromName(name: string): Partial<ToolSpecs> & { barLengthCm?: number } {
  const specs: Partial<ToolSpecs> & { barLengthCm?: number } = {};
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

  // RPM
  const rpmMatch = text.match(/(\d{3,5})\s*(?:об\/хв|об\.\/хв|rpm)/i);
  if (rpmMatch) specs.rpm = parseInt(rpmMatch[1]);

  // Disc diameter (common grinder/saw disc sizes in mm)
  const discMatch = text.match(/(\d{2,3})\s*мм/i);
  if (discMatch) {
    const val = parseInt(discMatch[1]);
    if ([115, 125, 150, 180, 230].includes(val)) specs.discDiameterMm = val;
  }

  // Bar length for chainsaws: "35 см", "40см" (20-100cm range)
  const barMatch = text.match(/(\d{2,3})\s*см\b/i);
  if (barMatch) {
    const val = parseInt(barMatch[1]);
    if (val >= 20 && val <= 100) specs.barLengthCm = val;
  }

  // Chuck
  const chuckMatch = text.match(/(?:патрон|chuck)\s*(\d{1,2})\s*мм/i)
    || text.match(/(\d{1,2})\s*мм\s*(?:патрон|chuck)/i);
  if (chuckMatch) specs.chuckMm = parseFloat(chuckMatch[1]);

  // Weight
  const weightMatch = text.match(/(\d+[.,]\d+)\s*кг/i);
  if (weightMatch) specs.weightKg = parseFloat(weightMatch[1].replace(",", "."));

  // Impact energy
  const joulesMatch = text.match(/(\d+[.,]?\d*)\s*(?:Дж|дж|J)\b/);
  if (joulesMatch) specs.impactEnergyJ = parseFloat(joulesMatch[1].replace(",", "."));

  // Voltage for battery tools
  const voltMatch = text.match(/(\d{2})\s*(?:В|V)\b/);
  if (voltMatch) {
    const v = parseInt(voltMatch[1]);
    if ([12, 14, 18, 20, 36, 40, 54].includes(v)) specs.voltageV = v;
  }

  // Brushless
  if (/безщітков|безщіточн|brushless|bl\b/i.test(lower)) specs.isBrushless = true;

  // Fallback: if no wattage parsed, try model number as watt hint
  // (e.g., "EPL 1600" → 1600W, common in Ukrainian product naming)
  if (!specs.powerWatts && !specs.voltageV) {
    const powerHint = text.match(/\b(800|900|1000|1100|1200|1300|1400|1500|1600|1800|2000|2200|2400|2500)\b/);
    if (powerHint) specs.powerWatts = parseInt(powerHint[1]);
  }

  return specs;
}

function estimatePowerFromJoules(joules: number, isBrushless: boolean): number {
  const factor = isBrushless ? 350 : 280;
  return Math.round(joules * factor);
}

function estimatePowerFromVoltage(voltage: number, toolType: ToolType, isBrushless: boolean): number {
  // Watts per volt (empirical, per tool type)
  const base: Record<ToolType, number> = {
    drill:         35,
    hammer_drill:  40,
    grinder:       45,
    circular_saw:  55,
    chainsaw:      26, // 40V*26*1.15 ≈ 1196W — realistic for battery chainsaw
    jigsaw:        30,
    sander:        20,
    impact_wrench: 40,
  };
  const factor = base[toolType] ?? 35;
  const brushlessBoost = isBrushless ? 1.15 : 1.0;
  return Math.round(voltage * factor * brushlessBoost);
}

function estimateRpmFromJoules(joules: number, isBrushless: boolean): number {
  const base = isBrushless ? 1800 : 1600;
  return Math.max(800, Math.min(3000, Math.round(base - (joules - 1.5) * 200)));
}

export function resolveSpecs(product: ProductInput): ToolSpecs {
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
      toolType = "grinder";
    }
    isEstimated = true;
  }

  // Override circular_saw → chainsaw if name clearly indicates chainsaw
  // (DB may have stored circular_saw for chainsaw products)
  if (toolType === "circular_saw") {
    const lower = product.name.toLowerCase();
    if (/бензопил|ланцюгов\w+\s+пил|електропил/.test(lower)) {
      toolType = "chainsaw";
    }
  }

  const defaults = CATEGORY_DEFAULTS[toolType];
  const parsed = parseSpecsFromName(product.name);

  let derivedPower: number | undefined;
  const isBrushless = parsed.isBrushless ?? false;

  if (!product.powerWatts && !parsed.powerWatts) {
    if (parsed.impactEnergyJ && toolType === "hammer_drill") {
      derivedPower = estimatePowerFromJoules(parsed.impactEnergyJ, isBrushless);
    } else if (parsed.voltageV) {
      derivedPower = estimatePowerFromVoltage(parsed.voltageV, toolType, isBrushless);
    }
  }

  let derivedRpm: number | undefined;
  if (!product.rpm && !parsed.rpm && parsed.impactEnergyJ && toolType === "hammer_drill") {
    derivedRpm = estimateRpmFromJoules(parsed.impactEnergyJ, isBrushless);
  }

  const specs: ToolSpecs = {
    toolType,
    isEstimated,
    powerWatts: product.powerWatts ?? parsed.powerWatts ?? derivedPower ?? defaults.powerWatts,
    rpm:         product.rpm ?? parsed.rpm ?? derivedRpm ?? defaults.rpm,
    discDiameterMm: product.discDiameterMm ?? parsed.discDiameterMm ?? defaults.discDiameterMm,
    chuckMm:     product.chuckMm ?? parsed.chuckMm ?? defaults.chuckMm,
    weightKg:    product.weightKg ?? parsed.weightKg ?? defaults.weightKg,
    impactEnergyJ: parsed.impactEnergyJ,
    voltageV:    parsed.voltageV,
    isBrushless,
    barLengthCm: parsed.barLengthCm ?? (defaults as any).barLengthCm,
  };

  if (isBrushless && !product.powerWatts && !parsed.powerWatts) {
    specs.powerWatts = Math.round(specs.powerWatts * 1.1);
  }

  if (product.powerWatts || product.rpm || product.discDiameterMm || product.toolType) {
    specs.isEstimated = false;
  }

  return specs;
}

export type SimulationType = "cutting" | "grinding" | "drilling";

const TOOL_TYPE_CAPABILITIES: Record<ToolType, SimulationType[]> = {
  grinder:      ["cutting", "grinding"],
  sander:       ["grinding"],
  drill:        ["drilling"],
  hammer_drill: ["drilling"],
  circular_saw: ["cutting"],
  chainsaw:     ["cutting"],
  jigsaw:       ["cutting"],
  impact_wrench:[],
};

export function getCompatibleSimulations(toolType: ToolType): SimulationType[] {
  return TOOL_TYPE_CAPABILITIES[toolType] || [];
}

export function isCompatible(toolType: ToolType, simType: SimulationType): boolean {
  return TOOL_TYPE_CAPABILITIES[toolType]?.includes(simType) ?? false;
}
