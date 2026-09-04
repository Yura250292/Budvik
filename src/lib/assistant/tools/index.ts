/**
 * Реєстр інструментів помічника.
 *
 * Порядок у списку — це порядок у схемі, яку бачить модель, і він не
 * випадковий: спершу «де я і що зі мною», далі клієнти, далі гроші, далі
 * товар. Модель читає опис зверху вниз, і для питання «сплануй день»
 * потрібний інструмент має траплятися першим.
 *
 * Тринадцять — стеля, яку варто тримати. Кожен інструмент коштує ~120
 * токенів у КОЖНОМУ запиті ходу; півсотні інструментів з'їли б контекст
 * ще до першого факту, а модель почала б обирати навмання.
 */

import type { AssistantKind, ToolDef, ToolSchema } from "@/lib/assistant/types";
import {
  dayRouteCandidatesTool,
  driverDayTool,
  myDayContext,
  routeHabitsTool,
} from "@/lib/assistant/tools/day";
import {
  searchClients,
  clientProfile,
  clientRecommendations,
  actionCandidates,
  rememberClient,
} from "@/lib/assistant/tools/clients";
import { receivables, salesSummary } from "@/lib/assistant/tools/money";
import { productSearch, deadStock, entryOfferTool } from "@/lib/assistant/tools/products";

export const TOOLS: ToolDef[] = [
  myDayContext,
  dayRouteCandidatesTool,
  routeHabitsTool,
  searchClients,
  clientProfile,
  entryOfferTool,
  clientRecommendations,
  actionCandidates,
  receivables,
  salesSummary,
  deadStock,
  productSearch,
  rememberClient,
  driverDayTool,
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/** Підписи для інтерфейсу: що саме зараз робить помічник. */
export const TOOL_LABELS: Record<string, string> = Object.fromEntries(
  TOOLS.map((t) => [t.name, t.label])
);

/**
 * Інструменти, видимі цьому виду помічника.
 *
 * Водієві дістається п'ять із чотирнадцяти — і це не лише про доречність.
 * Схема кожного інструмента їде в КОЖНОМУ запиті ходу, тож коротший
 * список у водія означає ще й утричі дешевший хід.
 */
export function toolsFor(kind: AssistantKind): ToolDef[] {
  return TOOLS.filter((t) => (t.kinds ?? ["SALES"]).includes(kind));
}

export function toolSchemas(kind: AssistantKind = "SALES"): ToolSchema[] {
  return toolsFor(kind).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
