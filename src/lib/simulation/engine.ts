import { Material } from "./materials";
import { ToolSpecs, SimulationType, isCompatible } from "./specs";
import type { Consumable } from "./consumables";

export interface SimulationInput {
  tool: ToolSpecs;
  material: Material;
  type: SimulationType;
  consumable?: Consumable; // optional consumable modifier
  thicknessMm?: number; // cutting: material thickness
  depthMm?: number; // drilling: hole depth
  holeDiameterMm?: number; // drilling: hole diameter
  surfaceAreaCm2?: number; // grinding: surface area
  logDiameterCm?: number; // chainsaw: log diameter
}

export interface SimulationMetrics {
  speed: number; // 0-100
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

function simulateCutting(tool: ToolSpecs, material: Material, thicknessMm: number): SimulationResult {
  const resistance = material.cuttingResistance;
  const discDiam = tool.discDiameterMm ?? 125;

  // Material removal rate (cm³/min) - heuristic
  const powerFactor = tool.powerWatts / 1000; // normalize to kW
  const rpmFactor = Math.min(tool.rpm / 11000, 1.5); // normalize to typical grinder RPM
  const discFactor = discDiam / 125; // normalize to 125mm
  const mrr = (powerFactor * rpmFactor * discFactor * 8) / (resistance * (material.density / 2700));

  // Volume to cut (cm³): thickness × disc diameter cut width × kerf (~3mm)
  const cutLengthCm = discDiam / 10;
  const volumeCm3 = (thicknessMm / 10) * cutLengthCm * 0.3;

  const timeSec = Math.max(1, (volumeCm3 / mrr) * 60);

  // Efficiency: optimal power range for material
  const optimalPower = resistance * 1200;
  const powerRatio = tool.powerWatts / optimalPower;
  const isOverpowered = powerRatio > 2;
  const isUnderpowered = powerRatio < 0.5;
  const efficiencyScore = clamp(100 - Math.abs(powerRatio - 1) * 40 - resistance * 15, 10, 100);

  // Wear rate
  const wearFactor = resistance * (tool.rpm / 10000) * (1 / discFactor);
  const wearRate: "low" | "medium" | "high" = wearFactor < 0.5 ? "low" : wearFactor < 1.0 ? "medium" : "high";

  // Heat
  const heatFactor = resistance * powerFactor * rpmFactor;
  const heatLevel = heatFactor < 0.3 ? "low" : heatFactor < 0.7 ? "medium" : heatFactor < 1.2 ? "high" : "critical";

  const warnings: string[] = [];
  if (isUnderpowered) warnings.push("Потужність недостатня для цього матеріалу");
  if (isOverpowered) warnings.push("Інструмент занадто потужний — зайвий знос диска");
  if (heatLevel === "critical") warnings.push("Високий нагрів — рекомендовано охолодження");
  if (thicknessMm > discDiam * 0.4) warnings.push("Товщина матеріалу близька до максимальної глибини різу");
  if (material.hardness >= 7 && tool.powerWatts < 1000) warnings.push("Для твердих матеріалів рекомендовано потужніший інструмент");

  const metrics: SimulationMetrics = {
    speed: clamp(Math.round((mrr / resistance) * 12), 5, 100),
    precision: clamp(Math.round(80 - (tool.powerWatts / 50) + (1 - resistance) * 20), 10, 100),
    durability: clamp(Math.round(90 - wearFactor * 40), 10, 100),
    safety: clamp(Math.round(70 - (heatFactor * 20) + (isUnderpowered ? -15 : 0)), 10, 100),
    efficiency: Math.round(efficiencyScore),
  };

  return {
    type: "cutting",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore: Math.round(efficiencyScore),
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics,
  };
}

function simulateGrinding(tool: ToolSpecs, material: Material, surfaceAreaCm2: number): SimulationResult {
  const resistance = material.grindingResistance;
  const discDiam = tool.discDiameterMm ?? 125;

  const powerFactor = tool.powerWatts / 1000;
  const rpmFactor = Math.min(tool.rpm / 11000, 1.5);
  const discFactor = discDiam / 125;

  // Surface removal rate (cm²/min)
  const srr = (powerFactor * rpmFactor * discFactor * 50) / (resistance + 0.1);
  const timeSec = Math.max(1, (surfaceAreaCm2 / srr) * 60);

  const optimalPower = resistance * 800;
  const powerRatio = tool.powerWatts / optimalPower;
  const isOverpowered = powerRatio > 2.5;
  const isUnderpowered = powerRatio < 0.4;
  const efficiencyScore = clamp(100 - Math.abs(powerRatio - 1.2) * 30 - resistance * 10, 10, 100);

  const wearFactor = resistance * 0.8 * (tool.rpm / 12000);
  const wearRate: "low" | "medium" | "high" = wearFactor < 0.4 ? "low" : wearFactor < 0.8 ? "medium" : "high";

  const heatFactor = resistance * powerFactor * 0.8;
  const heatLevel = heatFactor < 0.25 ? "low" : heatFactor < 0.6 ? "medium" : heatFactor < 1.0 ? "high" : "critical";

  const warnings: string[] = [];
  if (isUnderpowered) warnings.push("Потужність недостатня для ефективного шліфування");
  if (isOverpowered) warnings.push("Занадто потужний — ризик пошкодження поверхні");
  if (heatLevel === "critical") warnings.push("Критичний нагрів — використовуйте охолодження");

  const metrics: SimulationMetrics = {
    speed: clamp(Math.round(srr * 2), 5, 100),
    precision: clamp(Math.round(70 - powerFactor * 10 + (1 - resistance) * 30), 10, 100),
    durability: clamp(Math.round(85 - wearFactor * 35), 10, 100),
    safety: clamp(Math.round(80 - heatFactor * 15), 10, 100),
    efficiency: Math.round(efficiencyScore),
  };

  return {
    type: "grinding",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore: Math.round(efficiencyScore),
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics,
  };
}

function simulateDrilling(tool: ToolSpecs, material: Material, depthMm: number, holeDiameterMm: number): SimulationResult {
  const resistance = material.drillingResistance;

  const powerFactor = tool.powerWatts / 1000;
  const rpmFactor = tool.rpm / 2800; // normalize to typical drill RPM
  const diamFactor = holeDiameterMm / 10;

  // Torque approximation (Nm)
  const torque = (tool.powerWatts * 9.549) / tool.rpm;
  // Feed rate (mm/min)
  const feedRate = (torque * rpmFactor * 15) / (resistance * diamFactor * diamFactor + 0.5);
  const timeSec = Math.max(0.5, (depthMm / feedRate) * 60);

  const optimalPower = resistance * 900 * diamFactor;
  const powerRatio = tool.powerWatts / optimalPower;
  const isOverpowered = powerRatio > 2.5;
  const isUnderpowered = powerRatio < 0.4;
  const efficiencyScore = clamp(100 - Math.abs(powerRatio - 1) * 35 - resistance * 12, 10, 100);

  const wearFactor = resistance * diamFactor * 0.3 * (tool.rpm / 3000);
  const wearRate: "low" | "medium" | "high" = wearFactor < 0.4 ? "low" : wearFactor < 0.9 ? "medium" : "high";

  const heatFactor = resistance * powerFactor * diamFactor * 0.3;
  const heatLevel = heatFactor < 0.3 ? "low" : heatFactor < 0.7 ? "medium" : heatFactor < 1.2 ? "high" : "critical";

  // Need hammer drill for concrete/brick
  const needsHammer = material.hardness >= 6 && tool.toolType === "drill";

  const warnings: string[] = [];
  if (isUnderpowered) warnings.push("Потужність недостатня для свердління цього матеріалу");
  if (isOverpowered) warnings.push("Інструмент занадто потужний для цього отвору");
  if (needsHammer) warnings.push("Для цього матеріалу рекомендовано перфоратор");
  if (heatLevel === "critical") warnings.push("Критичний нагрів — робіть паузи для охолодження");
  if (holeDiameterMm > 20 && tool.powerWatts < 800) warnings.push("Для великих отворів потрібен потужніший інструмент");
  if (depthMm > 100) warnings.push("Глибоке свердління — видаляйте стружку періодично");

  const metrics: SimulationMetrics = {
    speed: clamp(Math.round(feedRate * 1.5), 5, 100),
    precision: clamp(Math.round(85 - diamFactor * 5 - (needsHammer ? 20 : 0)), 10, 100),
    durability: clamp(Math.round(90 - wearFactor * 30), 10, 100),
    safety: clamp(Math.round(85 - heatFactor * 15 - (needsHammer ? 10 : 0)), 10, 100),
    efficiency: Math.round(efficiencyScore),
  };

  return {
    type: "drilling",
    estimatedTimeSec: Math.round(timeSec * 10) / 10,
    efficiencyScore: Math.round(efficiencyScore),
    wearRate,
    heatLevel,
    isOverpowered,
    isUnderpowered,
    warnings,
    metrics,
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
  const newHeatLevel = newHeatFactor < 0.6 ? "low" as const : newHeatFactor < 0.9 ? "medium" as const : newHeatFactor < 1.2 ? "high" as const : "critical" as const;

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
      speed: clamp(Math.round(result.metrics.speed * consumable.speedFactor * compatBonus), 5, 100),
      precision: clamp(Math.round(result.metrics.precision * consumable.precisionFactor), 5, 100),
      durability: clamp(Math.round(result.metrics.durability * consumable.durabilityFactor), 5, 100),
      safety: clamp(Math.round(result.metrics.safety * (1 / consumable.heatFactor)), 5, 100),
      efficiency: newEff,
    },
  };
}

export function simulate(input: SimulationInput): SimulationResult {
  // For chainsaw mode, use cutting simulation with adapted params
  const isChainsawMode = input.consumable?.category === "chainsaw_chain";
  const effectiveType = isChainsawMode ? "cutting" as SimulationType : input.type;

  if (!isChainsawMode && !isCompatible(input.tool.toolType, input.type)) {
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

  // Calculate thickness from log diameter for chainsaw
  const thicknessMm = isChainsawMode && input.logDiameterCm
    ? input.logDiameterCm * 10
    : input.thicknessMm ?? 10;

  let result: SimulationResult;
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

  // Apply consumable modifiers if present
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

  let fastest = 0;
  let mostEfficient = 0;
  let leastWear = 0;
  let safest = 0;

  for (let i = 1; i < results.length; i++) {
    if (results[i].estimatedTimeSec < results[fastest].estimatedTimeSec) fastest = i;
    if (results[i].efficiencyScore > results[mostEfficient].efficiencyScore) mostEfficient = i;
    if (WEAR_ORDER[results[i].wearRate] < WEAR_ORDER[results[leastWear].wearRate]) leastWear = i;
    if (results[i].metrics.safety > results[safest].metrics.safety) safest = i;
  }

  return { results, winners: { fastest, mostEfficient, leastWear, safest } };
}
