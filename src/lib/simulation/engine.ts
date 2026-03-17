import { Material } from "./materials";
import { ToolSpecs, SimulationType, isCompatible } from "./specs";
import type { Consumable } from "./consumables";

export interface SimulationInput {
  tool: ToolSpecs;
  material: Material;
  type: SimulationType;
  consumable?: Consumable;
  thicknessMm?: number;
  depthMm?: number;
  holeDiameterMm?: number;
  surfaceAreaCm2?: number;
  logDiameterCm?: number;
}

export interface SimulationMetrics {
  speed: number;      // 0-100
  precision: number;
  durability: number;
  safety: number;
  efficiency: number;
}

export interface SimulationResult {
  type: SimulationType;
  estimatedTimeSec: number;
  efficiencyScore: number; // 0-100
  wearRate: "low" | "medium" | "high";
  heatLevel: "low" | "medium" | "high" | "critical";
  isOverpowered: boolean;
  isUnderpowered: boolean;
  warnings: string[];
  metrics: SimulationMetrics;
  toolName?: string;
  productId?: string;
  consumableName?: string;
  consumableId?: string;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

// Battery tools deliver ~80% rated power under sustained load (heat + voltage sag).
// Brushless motors are ~10% more efficient. Combined these shape "effective power".
function getEffectivePower(tool: ToolSpecs): number {
  const isBattery = !!tool.voltageV;
  const sustained = isBattery ? 0.80 : 1.0;
  const brushless = tool.isBrushless ? 1.10 : 1.0;
  return tool.powerWatts * sustained * brushless;
}

// Per-tool-type RPM normalization so 5000rpm circular saw ≠ "slow" grinder
const RPM_NORM: Partial<Record<string, number>> = {
  grinder: 11000,
  sander: 12000,
  circular_saw: 5000,
  jigsaw: 3000,
  drill: 2800,
  hammer_drill: 1200, // BPM-range, not RPM — treated as low in RPM-based formula
};

// ═══════════════════════════════════════════════════════════════════
// CHAINSAW SIMULATION
// Calibrated for realistic chainsaw physics:
//   1600W corded on 50cm soft wood → ~25s, efficiency ~77%
//   40V battery brushless on 50cm soft wood → ~38s, efficiency ~92%
// The corded is FASTER but less efficient; battery is SLOWER but more efficient.
// ═══════════════════════════════════════════════════════════════════
function simulateChainsaw(tool: ToolSpecs, material: Material, logDiameterCm: number): SimulationResult {
  const woodResistance = material.cuttingResistance; // 0.15 (soft) to 0.3 (hard)
  const barLengthCm = tool.barLengthCm ?? 35;
  const isBattery = !!tool.voltageV;

  // Battery tools lose ~28% vs rated power under sustained load
  const sustainedFactor = isBattery ? 0.72 : 1.0;
  const brushlessBonus = tool.isBrushless ? 1.18 : 1.0;
  const effectivePowerW = tool.powerWatts * sustainedFactor * brushlessBonus;

  // Material Removal Rate (cm³/s)
  // Coefficient calibrated: 1600W sustained → 55 cm³/s on soft wood (0.15)
  const MRR_COEFF = 5.16;
  const barFactor = clamp(barLengthCm / 35, 0.7, 1.4);
  const mrr = (effectivePowerW / 1000) * MRR_COEFF * barFactor / woodResistance;

  // Log cross-section volume through 0.7cm kerf
  const kerfCm = 0.7;
  const logAreaCm2 = Math.PI * (logDiameterCm / 2) ** 2;
  const volumeCm3 = logAreaCm2 * kerfCm;
  const timeSec = Math.max(2, volumeCm3 / mrr);

  // Optimal power window for this log size and material
  // Calibrated: 50cm soft wood → optimal ≈ 910W (battery near-optimal, corded slightly over)
  const optimalPowerW = logDiameterCm * 28 * (0.5 + woodResistance);
  const powerRatio = effectivePowerW / optimalPowerW;
  const isOverpowered = powerRatio > 2.8;
  const isUnderpowered = powerRatio < 0.4;

  // Battery tools pay 8-point efficiency penalty (portability trade-off)
  const batteryPenalty = isBattery ? 8 : 0;
  const efficiencyScore = clamp(
    Math.round(100 - Math.abs(powerRatio - 1) * 28 - woodResistance * 8
      + (tool.isBrushless ? 5 : 0) - batteryPenalty),
    10, 96
  );

  // Wear: battery tools have slightly higher chain wear (less consistent lubrication)
  const wearFactor = woodResistance * barFactor * (isBattery ? 1.1 : 0.9);
  const wearRate: "low" | "medium" | "high" =
    wearFactor < 0.15 ? "low" : wearFactor < 0.35 ? "medium" : "high";

  // Heat: corded runs hotter under continuous load; battery throttles before overheating
  const heatFactor = (effectivePowerW / 1000) * woodResistance * (isBattery ? 0.75 : 1.1);
  const heatLevel: "low" | "medium" | "high" | "critical" =
    heatFactor < 0.15 ? "low" : heatFactor < 0.35 ? "medium" : heatFactor < 0.70 ? "high" : "critical";

  // Bar capacity check
  const barCanReachCenter = barLengthCm > logDiameterCm / 2;

  const warnings: string[] = [];
  if (!barCanReachCenter) {
    warnings.push(`Шина ${barLengthCm}см — замала для колоди ${logDiameterCm}см. Потрібна шина > ${Math.ceil(logDiameterCm / 2)}см`);
  }
  if (isUnderpowered) warnings.push("Потужність недостатня для цього діаметру колоди");
  if (isOverpowered) warnings.push("Надлишкова потужність для цього завдання");
  if (isBattery) warnings.push("Акумуляторна — обмежений ресурс заряду на одну колоду");
  if (!isBattery) warnings.push("Мережева — стабільна повна потужність без обмежень заряду");
  if (tool.isBrushless) warnings.push("Безщітковий двигун — вища ефективність та довший ресурс");
  if (heatLevel === "critical") warnings.push("Критичний нагрів — використовуйте з паузами");

  // Speed: faster = higher MRR (raw cutting speed)
  const speedMetric = clamp(Math.round(mrr * 1.75), 5, 100);

  // Precision: battery has electronic brake = more controlled; longer bar = more kickback risk
  const precisionMetric = clamp(
    Math.round(72 + (isBattery ? 8 : 0) + (tool.isBrushless ? 5 : 0) - (barLengthCm - 30) * 0.3),
    30, 95
  );

  // Durability: brushless motor + shorter bar = better durability
  const durabilityMetric = clamp(
    Math.round(80 - wearFactor * 50 + (tool.isBrushless ? 10 : 0) - (isBattery ? 5 : 0)),
    20, 95
  );

  // Safety: electronic brake on battery = safer; longer bar = more kickback
  const safetyMetric = clamp(
    Math.round(70 + (isBattery ? 10 : 0) - (barLengthCm - 30) * 0.4 - heatFactor * 18
      + (tool.isBrushless ? 3 : 0)),
    20, 95
  );

  return {
    type: "cutting",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore,
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics: {
      speed: speedMetric,
      precision: precisionMetric,
      durability: durabilityMetric,
      safety: safetyMetric,
      efficiency: efficiencyScore,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
// CUTTING SIMULATION (angle grinder, circular saw, jigsaw)
// Optimal power formula is tool-type aware:
//   - Grinder: calibrated for metal/masonry (optimalPower = resistance * 1200)
//   - Circular saw / jigsaw: calibrated for larger cross-sections in wood/aluminum
// ═══════════════════════════════════════════════════════════════════
function simulateCutting(tool: ToolSpecs, material: Material, thicknessMm: number): SimulationResult {
  const resistance = material.cuttingResistance;
  const discDiam = tool.discDiameterMm ?? 125;
  const isBattery = !!tool.voltageV;

  // Use effective power (battery sustained + brushless bonus)
  const effectivePowerW = getEffectivePower(tool);
  const powerFactor = effectivePowerW / 1000;

  // RPM factor normalized per tool type — circular saws run at 5000 RPM by design, not "slow"
  const rpmNorm = RPM_NORM[tool.toolType] ?? 11000;
  const rpmFactor = Math.min(tool.rpm / rpmNorm, 1.5);
  const discFactor = discDiam / 125;

  const mrr = (powerFactor * rpmFactor * discFactor * 8) / (resistance * (material.density / 2700));
  const cutLengthCm = discDiam / 10;
  const volumeCm3 = (thicknessMm / 10) * cutLengthCm * 0.3;
  const timeSec = Math.max(0.5, (volumeCm3 / mrr) * 60);

  // Tool-type-specific optimal power calibration
  let optimalPower: number;
  if (tool.toolType === "circular_saw" || tool.toolType === "jigsaw") {
    // Soft wood (0.15): max(600, 0.15*4000)+185*3 = 1155W → 1400W ratio ≈ 1.21 ✓
    // Hard wood (0.3): max(600, 1200)+555 = 1755W → 1400W ratio ≈ 0.80 ✓
    optimalPower = Math.max(600, resistance * 4000) + discDiam * 3;
  } else {
    // Angle grinder: calibrated for metal (900W grinder on steel ≈ 840W optimal)
    // Minimum 450W so tool doesn't get extreme overpower penalty on soft materials
    optimalPower = Math.max(450, resistance * 1200);
  }

  const powerRatio = effectivePowerW / optimalPower;
  const isOverpowered = powerRatio > 2.2;
  const isUnderpowered = powerRatio < 0.5;

  // Asymmetric penalty: overpowered still works (energy waste), underpowered struggles
  const rawPenalty = powerRatio > 1
    ? (powerRatio - 1) * 22    // overpowered: gentler curve
    : (1 - powerRatio) * 42;   // underpowered: steeper curve
  const batteryPenalty = isBattery ? 5 : 0; // portability trade-off
  const efficiencyScore = clamp(Math.round(100 - rawPenalty - resistance * 10 - batteryPenalty), 10, 100);

  const wearFactor = resistance * (tool.rpm / 10000) * (1 / discFactor);
  const wearRate: "low" | "medium" | "high" =
    wearFactor < 0.5 ? "low" : wearFactor < 1.0 ? "medium" : "high";

  const heatFactor = resistance * powerFactor * rpmFactor;
  const heatLevel: "low" | "medium" | "high" | "critical" =
    heatFactor < 0.3 ? "low" : heatFactor < 0.7 ? "medium" : heatFactor < 1.2 ? "high" : "critical";

  const warnings: string[] = [];
  if (isUnderpowered) warnings.push("Потужність недостатня для цього матеріалу");
  if (isOverpowered) warnings.push("Інструмент занадто потужний — зайвий знос диска");
  if (heatLevel === "critical") warnings.push("Високий нагрів — рекомендовано охолодження");
  if (thicknessMm > discDiam * 0.4) warnings.push("Товщина матеріалу близька до максимальної глибини різу");
  if (material.hardness >= 7 && effectivePowerW < 900) warnings.push("Для твердих матеріалів рекомендовано потужніший інструмент");
  if (isBattery) warnings.push("Акумуляторний — ефективна потужність ~80% від номінальної під навантаженням");
  if (tool.isBrushless) warnings.push("Безщітковий двигун — вища ефективність та довший ресурс");

  return {
    type: "cutting",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore,
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics: {
      speed:      clamp(Math.round((mrr / Math.max(resistance, 0.1)) * 10), 5, 100),
      precision:  clamp(Math.round(80 - (tool.powerWatts / 55) + (1 - resistance) * 20 + (isBattery ? 5 : 0)), 10, 100),
      durability: clamp(Math.round(90 - wearFactor * 40 + (tool.isBrushless ? 5 : 0)), 10, 100),
      safety:     clamp(Math.round(72 - heatFactor * 20 + (isUnderpowered ? -15 : 0) + (isBattery ? 6 : 0)), 10, 100),
      efficiency: efficiencyScore,
    },
  };
}

function simulateGrinding(tool: ToolSpecs, material: Material, surfaceAreaCm2: number): SimulationResult {
  const resistance = material.grindingResistance;
  const discDiam = tool.discDiameterMm ?? 125;
  const isBattery = !!tool.voltageV;

  const effectivePowerW = getEffectivePower(tool);
  const powerFactor = effectivePowerW / 1000;
  const rpmFactor = Math.min(tool.rpm / 11000, 1.5);
  const discFactor = discDiam / 125;

  const srr = (powerFactor * rpmFactor * discFactor * 50) / (resistance + 0.1);
  const timeSec = Math.max(0.5, (surfaceAreaCm2 / srr) * 60);

  // Tool-type-aware optimal power — sanders are designed for light work, grinders for heavy
  // Minimums prevent extreme overpowered penalties on easy materials (soft wood, aluminum)
  const isSander = tool.toolType === "sander";
  const optimalPower = isSander
    ? Math.max(200, resistance * 900)   // sander: optimal 200-720W range
    : Math.max(500, resistance * 1600); // grinder: optimal 500-1280W range

  const powerRatio = effectivePowerW / optimalPower;
  const isOverpowered = powerRatio > 2.5;
  const isUnderpowered = powerRatio < 0.4;

  // Asymmetric penalty: target powerRatio ≈ 1.1 (slight overpower is fine for grinding)
  const rawPenalty = powerRatio > 1.1
    ? (powerRatio - 1.1) * 22   // overpowered: gentler
    : (1.1 - powerRatio) * 38;  // underpowered: steeper
  const batteryPenalty = isBattery ? 5 : 0;
  const efficiencyScore = clamp(Math.round(100 - rawPenalty - resistance * 8 - batteryPenalty), 10, 100);

  const wearFactor = resistance * 0.8 * (tool.rpm / 12000);
  const wearRate: "low" | "medium" | "high" =
    wearFactor < 0.4 ? "low" : wearFactor < 0.8 ? "medium" : "high";

  const heatFactor = resistance * powerFactor * 0.8;
  const heatLevel: "low" | "medium" | "high" | "critical" =
    heatFactor < 0.25 ? "low" : heatFactor < 0.6 ? "medium" : heatFactor < 1.0 ? "high" : "critical";

  const warnings: string[] = [];
  if (isUnderpowered) warnings.push("Потужність недостатня для ефективного шліфування");
  if (isOverpowered) warnings.push("Занадто потужний — ризик пошкодження поверхні");
  if (heatLevel === "critical") warnings.push("Критичний нагрів — використовуйте охолодження");
  if (isBattery) warnings.push("Акумуляторний — ефективна потужність ~80% від номінальної під навантаженням");
  if (tool.isBrushless) warnings.push("Безщітковий двигун — стабільна швидкість оборотів та менше тепла");

  return {
    type: "grinding",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore,
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics: {
      speed:      clamp(Math.round(srr * 2), 5, 100),
      precision:  clamp(Math.round(72 - powerFactor * 9 + (1 - resistance) * 28 + (isSander ? 8 : 0) + (isBattery ? 4 : 0)), 10, 100),
      durability: clamp(Math.round(85 - wearFactor * 35 + (tool.isBrushless ? 5 : 0)), 10, 100),
      safety:     clamp(Math.round(80 - heatFactor * 15 + (isBattery ? 5 : 0)), 10, 100),
      efficiency: efficiencyScore,
    },
  };
}

function simulateDrilling(tool: ToolSpecs, material: Material, depthMm: number, holeDiameterMm: number): SimulationResult {
  const resistance = material.drillingResistance;
  const diamFactor = holeDiameterMm / 10;
  const isBattery = !!tool.voltageV;

  const effectivePowerW = getEffectivePower(tool);
  const powerFactor = effectivePowerW / 1000;
  const rpmFactor = tool.rpm / 2800;

  const impactJ = tool.impactEnergyJ ?? 0;
  const impactBonus = tool.toolType === "hammer_drill" && impactJ > 0
    ? impactJ / 2.0 : 0;

  // Torque uses effective power (battery sustained, brushless boost already in getEffectivePower)
  const torque = (effectivePowerW * 9.549) / tool.rpm;
  const impactFeedBoost = material.hardness >= 5 ? (1 + impactBonus * 0.6) : (1 + impactBonus * 0.2);
  const feedRate = (torque * rpmFactor * 15 * impactFeedBoost)
    / (resistance * diamFactor * diamFactor + 0.5);
  const timeSec = Math.max(0.5, (depthMm / feedRate) * 60);

  // Minimum optimal power prevents extreme overpowered penalty on easy materials (wood, small holes)
  const optimalPower = Math.max(250, resistance * 900 * diamFactor);
  const effectivePowerWithImpact = effectivePowerW * (1 + impactBonus * 0.3);
  const powerRatio = effectivePowerWithImpact / optimalPower;
  const isOverpowered = powerRatio > 2.8;
  const isUnderpowered = powerRatio < 0.4;

  // Asymmetric penalty: overpowered drills still work, underpowered drills really struggle
  const rawPenalty = powerRatio > 1
    ? (powerRatio - 1) * 18    // overpowered: gentle — bigger drill still bores fine
    : (1 - powerRatio) * 45;   // underpowered: steep — can't generate enough torque
  const batteryPenalty = isBattery ? 5 : 0;
  const efficiencyScore = clamp(
    Math.round(100 - rawPenalty - resistance * 10 + (impactBonus * 6) + (tool.isBrushless ? 5 : 0) - batteryPenalty),
    10, 100
  );

  const wearFactor = resistance * diamFactor * 0.3 * (tool.rpm / 3000) / (1 + impactBonus * 0.2);
  const wearRate: "low" | "medium" | "high" =
    wearFactor < 0.4 ? "low" : wearFactor < 0.9 ? "medium" : "high";

  const heatFactor = resistance * powerFactor * diamFactor * 0.3 / (tool.isBrushless ? 1.12 : 1.0);
  const heatLevel: "low" | "medium" | "high" | "critical" =
    heatFactor < 0.3 ? "low" : heatFactor < 0.7 ? "medium" : heatFactor < 1.2 ? "high" : "critical";

  const needsHammer = material.hardness >= 6 && tool.toolType === "drill";

  const warnings: string[] = [];
  if (isUnderpowered) warnings.push("Потужність недостатня для свердління цього матеріалу");
  if (isOverpowered) warnings.push("Інструмент занадто потужний для цього отвору");
  if (needsHammer) warnings.push("Для цього матеріалу рекомендовано перфоратор");
  if (heatLevel === "critical") warnings.push("Критичний нагрів — робіть паузи для охолодження");
  if (holeDiameterMm > 20 && effectivePowerW < 700) warnings.push("Для великих отворів потрібен потужніший інструмент");
  if (depthMm > 100) warnings.push("Глибоке свердління — видаляйте стружку періодично");
  if (isBattery) warnings.push("Акумуляторний — ефективна потужність ~80% від номінальної під навантаженням");
  if (tool.isBrushless) warnings.push("Безщітковий двигун — вища ефективність та ресурс");
  if (impactJ >= 3) warnings.push(`Висока енергія удару (${impactJ} Дж) — відмінно для бетону`);

  return {
    type: "drilling",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore,
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics: {
      speed:      clamp(Math.round(feedRate * 1.5), 5, 100),
      precision:  clamp(Math.round(85 - diamFactor * 5 - (needsHammer ? 20 : 0) + (tool.isBrushless ? 5 : 0) + (isBattery ? 3 : 0)), 10, 100),
      durability: clamp(Math.round(90 - wearFactor * 30 + (tool.isBrushless ? 8 : 0)), 10, 100),
      safety:     clamp(Math.round(85 - heatFactor * 15 - (needsHammer ? 10 : 0) + (isBattery ? 4 : 0)), 10, 100),
      efficiency: efficiencyScore,
    },
  };
}

function applyConsumable(result: SimulationResult, consumable: Consumable, materialId: string): SimulationResult {
  const compat = consumable.materialCompat[materialId] ?? 1;

  if (compat === 0) {
    return {
      ...result,
      estimatedTimeSec: result.estimatedTimeSec * 5,
      efficiencyScore: 5,
      wearRate: "high",
      heatLevel: "critical",
      warnings: [...result.warnings, `"${consumable.nameUk}" не сумісний з цим матеріалом`],
      metrics: { speed: 5, precision: 5, durability: 5, safety: 10, efficiency: 5 },
      consumableName: consumable.nameUk,
      consumableId: consumable.id,
    };
  }

  const compatBonus = compat === 2 ? 1.15 : 1.0;
  const newTime = result.estimatedTimeSec / (consumable.speedFactor * compatBonus);
  const newHeatFactor = consumable.heatFactor / compatBonus;

  const wearBase = 1 / consumable.durabilityFactor;
  const newWearRate: "low" | "medium" | "high" = wearBase < 0.7 ? "low" : wearBase < 1.2 ? "medium" : "high";
  const newHeatLevel =
    newHeatFactor < 0.6 ? "low" as const :
    newHeatFactor < 0.9 ? "medium" as const :
    newHeatFactor < 1.2 ? "high" as const : "critical" as const;

  const effBoost = (consumable.speedFactor + consumable.durabilityFactor + consumable.precisionFactor) / 3;
  const newEff = clamp(Math.round(result.efficiencyScore * effBoost * compatBonus * 0.85), 10, 100);

  const warnings = [...result.warnings];
  if (consumable.durabilityFactor < 0.7) warnings.push(`"${consumable.nameUk}" зношується швидко`);
  if (consumable.heatFactor > 1.2) warnings.push(`"${consumable.nameUk}" генерує багато тепла`);

  return {
    ...result,
    estimatedTimeSec: Math.round(newTime * 10) / 10,
    efficiencyScore: newEff,
    wearRate: newWearRate,
    heatLevel: newHeatLevel,
    warnings,
    consumableName: consumable.nameUk,
    consumableId: consumable.id,
    metrics: {
      speed:      clamp(Math.round(result.metrics.speed * consumable.speedFactor * compatBonus), 5, 100),
      precision:  clamp(Math.round(result.metrics.precision * consumable.precisionFactor), 5, 100),
      durability: clamp(Math.round(result.metrics.durability * consumable.durabilityFactor), 5, 100),
      safety:     clamp(Math.round(result.metrics.safety * (1 / consumable.heatFactor)), 5, 100),
      efficiency: newEff,
    },
  };
}

export function simulate(input: SimulationInput): SimulationResult {
  const isChainsawConsumable = input.consumable?.category === "chainsaw_chain";
  const effectiveType = isChainsawConsumable ? "cutting" as SimulationType : input.type;

  if (!isChainsawConsumable && !isCompatible(input.tool.toolType, input.type)) {
    return {
      type: input.type,
      estimatedTimeSec: 0,
      efficiencyScore: 0,
      wearRate: "high",
      heatLevel: "critical",
      isOverpowered: false,
      isUnderpowered: true,
      warnings: [`Інструмент типу "${input.tool.toolType}" не підходить для операції "${input.type}"`],
      metrics: { speed: 0, precision: 0, durability: 0, safety: 0, efficiency: 0 },
    };
  }

  let result: SimulationResult;

  // Chainsaw gets its own simulation regardless of effectiveType
  if (input.tool.toolType === "chainsaw" || isChainsawConsumable) {
    const logDiameterCm = input.logDiameterCm
      ?? (input.thicknessMm ? input.thicknessMm / 10 : 30);
    result = simulateChainsaw(input.tool, input.material, logDiameterCm);
  } else {
    const thicknessMm = input.thicknessMm ?? 10;
    switch (effectiveType) {
      case "cutting":
        result = simulateCutting(input.tool, input.material, thicknessMm);
        break;
      case "grinding":
        result = simulateGrinding(input.tool, input.material, input.surfaceAreaCm2 ?? 100);
        break;
      case "drilling":
        result = simulateDrilling(input.tool, input.material, input.depthMm ?? 30, input.holeDiameterMm ?? 8);
        break;
    }
  }

  if (input.consumable) {
    result = applyConsumable(result, input.consumable, input.material.id);
  }

  return result;
}

export interface ComparisonResult {
  results: SimulationResult[];
  winners: {
    fastest: number;
    mostEfficient: number;
    leastWear: number;
    safest: number;
  };
}

const WEAR_ORDER = { low: 0, medium: 1, high: 2 };

export function compareSimulations(results: SimulationResult[]): ComparisonResult {
  if (results.length === 0) {
    return { results: [], winners: { fastest: 0, mostEfficient: 0, leastWear: 0, safest: 0 } };
  }

  let fastest = 0, mostEfficient = 0, leastWear = 0, safest = 0;
  for (let i = 1; i < results.length; i++) {
    if (results[i].estimatedTimeSec < results[fastest].estimatedTimeSec) fastest = i;
    if (results[i].efficiencyScore > results[mostEfficient].efficiencyScore) mostEfficient = i;
    if (WEAR_ORDER[results[i].wearRate] < WEAR_ORDER[results[leastWear].wearRate]) leastWear = i;
    if (results[i].metrics.safety > results[safest].metrics.safety) safest = i;
  }

  return { results, winners: { fastest, mostEfficient, leastWear, safest } };
}
