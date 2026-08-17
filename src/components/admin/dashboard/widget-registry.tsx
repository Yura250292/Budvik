"use client";

import dynamic from "next/dynamic";
import type { AdminRole } from "@/lib/admin-nav";
import type { IconKey } from "../icons";
import type { WidgetSize, WidgetType } from "./layout-schema";
import { StatClients, StatOrders, StatProducts, StatWholesale } from "./widgets/StatWidgets";
import RecentOrders from "./widgets/RecentOrders";
import { MoneyWidget, OverdueReps, PlanAttainment, SalesTotals, TopReps } from "./widgets/SalesWidgets";
// Єдине місце, де recharts потрапляв у бандл дашборду статично: через
// next/dynamic бібліотека (~150 КБ gzip) їде окремим чанком лише тоді,
// коли віджет справді на екрані — так само, як уже зроблено в Charts.tsx.
const RevenueTimeline = dynamic(() => import("./widgets/OverviewWidgets").then((m) => m.RevenueTimeline));
const BrandsWidget = dynamic(() => import("./widgets/OverviewWidgets").then((m) => m.BrandsWidget));
const TopClients = dynamic(() => import("./widgets/OverviewWidgets").then((m) => m.TopClients));
const TopProducts = dynamic(() => import("./widgets/OverviewWidgets").then((m) => m.TopProducts));
import {
  WarehouseNomenclature,
  WarehouseProductivity,
  WarehouseShifts,
  WarehouseTotals,
} from "./widgets/WarehouseWidgets";
import { WeatherForecast, WeatherWidget } from "./widgets/WeatherWidget";
import { CalculatorWidget, CurrencyRates } from "./widgets/CurrencyWidget";
import { NotesWidget } from "./widgets/NotesWidget";
import { ClockWidget } from "./widgets/ClockWidget";
import { QuickActions } from "./widgets/QuickActions";

export type WidgetGroup = "Аналітика продажів" | "Склад" | "Магазин" | "Інструменти";

export type WidgetDef = {
  type: WidgetType;
  title: string;
  iconKey: IconKey;
  group: WidgetGroup;
  roles: AdminRole[];
  defaultSize: WidgetSize;
  allowedSizes: WidgetSize[];
  Render: (props: { role: AdminRole }) => React.ReactNode;
};

const ALL: AdminRole[] = ["ADMIN", "MANAGER", "SALES"];
const AM: AdminRole[] = ["ADMIN", "MANAGER"];

/** Лічильники клієнтів/оптовиків доступні лише ADMIN і MANAGER. */
const withUsers = (role: AdminRole) => role === "ADMIN" || role === "MANAGER";

export const WIDGET_REGISTRY: Record<WidgetType, WidgetDef> = {
  // ——— Аналітика продажів: «Зведена» ———
  "sales-totals": {
    type: "sales-totals",
    title: "Продажі за період",
    iconKey: "money",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "4x1",
    allowedSizes: ["2x1", "3x1", "4x1"],
    Render: () => <SalesTotals />,
  },
  "plan-attainment": {
    type: "plan-attainment",
    title: "Виконання плану",
    iconKey: "star",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "2x1",
    allowedSizes: ["1x1", "2x1", "2x2"],
    Render: () => <PlanAttainment />,
  },
  money: {
    type: "money",
    title: "Гроші: зібрано і дебіторка",
    iconKey: "price",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "2x1",
    allowedSizes: ["2x1", "3x1", "4x1"],
    Render: () => <MoneyWidget />,
  },
  "top-reps": {
    type: "top-reps",
    title: "Торгові за оборотом",
    iconKey: "team",
    group: "Аналітика продажів",
    roles: AM,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <TopReps />,
  },
  "overdue-reps": {
    type: "overdue-reps",
    title: "Прострочена дебіторка",
    iconKey: "invoice",
    group: "Аналітика продажів",
    roles: AM,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <OverdueReps />,
  },

  // ——— Аналітика продажів: «Огляд» ———
  "revenue-timeline": {
    type: "revenue-timeline",
    title: "Динаміка обороту",
    iconKey: "chart",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "4x2",
    allowedSizes: ["2x2", "4x1", "4x2"],
    Render: () => <RevenueTimeline />,
  },
  brands: {
    type: "brands",
    title: "Продажі по фірмах",
    iconKey: "products",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <BrandsWidget />,
  },
  "top-clients": {
    type: "top-clients",
    title: "Топ клієнтів",
    iconKey: "clients",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <TopClients />,
  },
  "top-products": {
    type: "top-products",
    title: "Топ товарів",
    iconKey: "products",
    group: "Аналітика продажів",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <TopProducts />,
  },

  // ——— Склад ———
  "warehouse-totals": {
    type: "warehouse-totals",
    title: "Склад за період",
    iconKey: "warehouse",
    group: "Склад",
    roles: AM,
    defaultSize: "4x1",
    allowedSizes: ["2x1", "3x1", "4x1"],
    Render: () => <WarehouseTotals />,
  },
  "warehouse-shifts": {
    type: "warehouse-shifts",
    title: "Зараз на зміні",
    iconKey: "team",
    group: "Склад",
    roles: AM,
    defaultSize: "2x1",
    allowedSizes: ["2x1", "2x2", "3x1"],
    Render: () => <WarehouseShifts />,
  },
  "warehouse-productivity": {
    type: "warehouse-productivity",
    title: "Продуктивність складу",
    iconKey: "chart",
    group: "Склад",
    roles: AM,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <WarehouseProductivity />,
  },
  "warehouse-nomenclature": {
    type: "warehouse-nomenclature",
    title: "Номенклатура складу",
    iconKey: "purchase",
    group: "Склад",
    roles: AM,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <WarehouseNomenclature />,
  },

  // ——— Магазин (сайт) ———
  "stat-orders": {
    type: "stat-orders",
    title: "Замовлення сайту",
    iconKey: "orders",
    group: "Магазин",
    roles: ALL,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatOrders withUsers={withUsers(role)} />,
  },
  "stat-products": {
    type: "stat-products",
    title: "Товари",
    iconKey: "products",
    group: "Магазин",
    // Плитка веде на /admin/products, куди SALES не пускає middleware.
    roles: AM,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatProducts withUsers={withUsers(role)} />,
  },
  "stat-clients": {
    type: "stat-clients",
    title: "Клієнти",
    iconKey: "clients",
    group: "Магазин",
    roles: AM,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatClients withUsers={withUsers(role)} />,
  },
  "stat-wholesale": {
    type: "stat-wholesale",
    title: "Оптовики",
    iconKey: "wholesale",
    group: "Магазин",
    roles: AM,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatWholesale withUsers={withUsers(role)} />,
  },
  "recent-orders": {
    type: "recent-orders",
    title: "Останні замовлення",
    iconKey: "orders",
    group: "Магазин",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x1", "2x2", "3x1", "4x2"],
    Render: () => <RecentOrders />,
  },

  // ——— Інструменти ———
  // Доступні всім ролям: це не дані компанії, а побутова зручність,
  // тож ховати їх від торгового немає сенсу.
  weather: {
    type: "weather",
    title: "Погода",
    iconKey: "seasonal",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x1",
    allowedSizes: ["2x1", "2x2", "3x1"],
    Render: () => <WeatherWidget />,
  },
  "weather-forecast": {
    type: "weather-forecast",
    title: "Прогноз погоди",
    iconKey: "seasonal",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x1", "2x2", "3x1"],
    Render: () => <WeatherForecast />,
  },
  currency: {
    type: "currency",
    title: "Курс валют",
    iconKey: "price",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x1",
    allowedSizes: ["2x1", "2x2", "3x1", "4x1"],
    Render: () => <CurrencyRates />,
  },
  calculator: {
    type: "calculator",
    title: "Калькулятор і конвертер",
    iconKey: "money",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1"],
    Render: () => <CalculatorWidget />,
  },
  notes: {
    type: "notes",
    title: "Нотатки",
    iconKey: "page",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x2", "3x1", "4x2"],
    Render: () => <NotesWidget />,
  },
  clock: {
    type: "clock",
    title: "Час і календар",
    iconKey: "report",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x1",
    allowedSizes: ["2x1", "2x2", "3x1"],
    Render: () => <ClockWidget />,
  },
  "quick-actions": {
    type: "quick-actions",
    title: "Швидкі дії",
    iconKey: "dashboard",
    group: "Інструменти",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x1", "2x2", "3x1"],
    Render: ({ role }) => <QuickActions role={role} />,
  },
};

export const WIDGET_LIST = Object.values(WIDGET_REGISTRY);

export function widgetsForRole(role: AdminRole): WidgetDef[] {
  return WIDGET_LIST.filter((w) => w.roles.includes(role));
}

export function isKnownWidget(type: string): type is WidgetType {
  return type in WIDGET_REGISTRY;
}
