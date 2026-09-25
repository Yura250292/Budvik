import type { VehicleServiceKind } from "@prisma/client";

/** Підписи видів обслуговування — одні й ті самі в адмінці, помічнику й MCP. */
export const KIND_LABEL: Record<VehicleServiceKind, string> = {
  OIL: "Масло",
  FILTERS: "Фільтри",
  BRAKES: "Гальма",
  TIRES: "Шини",
  TIMING: "ГРМ",
  BATTERY: "Акумулятор",
  SUSPENSION: "Ходова",
  REPAIR: "Ремонт",
  INSPECTION: "Техогляд / діагностика",
  OTHER: "Інше",
};

export const KINDS = Object.keys(KIND_LABEL) as VehicleServiceKind[];

export function isKind(value: unknown): value is VehicleServiceKind {
  return typeof value === "string" && value in KIND_LABEL;
}
