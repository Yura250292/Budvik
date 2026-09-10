/**
 * Реєстр інструментів помічника.
 *
 * Порядок у списку — це порядок у схемі, яку бачить модель, і він не
 * випадковий: спершу «де я і що зі мною», далі клієнти, далі гроші, далі
 * товар. Модель читає опис зверху вниз, і для питання «сплануй день»
 * потрібний інструмент має траплятися першим.
 *
 * Стеля: тринадцять для торгового, двадцять для керівника. Кожен інструмент
 * коштує ~120 токенів у КОЖНОМУ запиті ходу; півсотні інструментів з'їли б
 * контекст ще до першого факту, а модель почала б обирати навмання. Далі
 * рости лише режимами (mode) усередині наявних схем — так уже живуть
 * stock_health, money_flows, sales_analysis і site_report. Загальний список
 * довший — його рятує фільтр kinds: кожен вид бачить лише своє.
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
import { remindMe, myReminders } from "@/lib/assistant/tools/reminders";
import { productSearch, deadStock, entryOfferTool } from "@/lib/assistant/tools/products";
import {
  driversTodayTool,
  ordersToPackTool,
  myInvoicesTool,
} from "@/lib/assistant/tools/warehouse";
import {
  driversReportTool,
  shiftsReportTool,
  staffNowTool,
  stockHealthTool,
  syncHealthTool,
  teamOverviewTool,
  teamReceivablesTool,
} from "@/lib/assistant/tools/admin";
import { moneyFlowsTool, salesAnalysisTool, siteReportTool } from "@/lib/assistant/tools/admin-money";
import { staffProfileTool } from "@/lib/assistant/tools/staff";
import { documentsTool } from "@/lib/assistant/tools/documents";
import { buildRouteTool } from "@/lib/assistant/tools/route";
import { queryDbTool } from "@/lib/assistant/tools/query";

export const TOOLS: ToolDef[] = [
  myDayContext,
  dayRouteCandidatesTool,
  routeHabitsTool,
  /*
   * Керівницькі — одразу після денних: у керівника «де я і що зі мною» —
   * це «хто де зараз» і «як іде команда», тобто перше, чого модель має
   * шукати. Решті видів вони не видно (див. kinds), тож порядок для них
   * не міняється.
   */
  staffNowTool,
  teamOverviewTool,
  staffProfileTool,
  teamReceivablesTool,
  documentsTool,
  shiftsReportTool,
  driversReportTool,
  /*
   * Складські — одразу після денних і перед клієнтськими: у складовщика це
   * і є «де я і що зі мною», тобто перше, чого модель має шукати.
   * Керівник бачить drivers_today тут же, поруч із водіями.
   */
  driversTodayTool,
  buildRouteTool,
  siteReportTool,
  stockHealthTool,
  syncHealthTool,
  moneyFlowsTool,
  salesAnalysisTool,
  /* Останнім із керівницьких: спершу готові зведення, і лише потім довільний SELECT. */
  queryDbTool,
  ordersToPackTool,
  myInvoicesTool,
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
  remindMe,
  myReminders,
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
 * Водієві й складовщикові дістається по кілька з усього списку — і це не
 * лише про доречність. Схема кожного інструмента їде в КОЖНОМУ запиті ходу,
 * тож коротший список означає ще й утричі дешевший хід.
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
