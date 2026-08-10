"use client";

import type { AdminRole } from "@/lib/admin-nav";
import type { IconKey } from "../icons";
import type { WidgetSize, WidgetType } from "./layout-schema";
import { StatClients, StatOrders, StatProducts, StatWholesale } from "./widgets/StatWidgets";
import RecentOrders from "./widgets/RecentOrders";
import SalesSummary from "./widgets/SalesSummary";
import RevenueChart from "./widgets/RevenueChart";

export type WidgetDef = {
  type: WidgetType;
  title: string;
  iconKey: IconKey;
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
  "stat-orders": {
    type: "stat-orders",
    title: "Замовлення",
    iconKey: "orders",
    roles: ALL,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatOrders withUsers={withUsers(role)} />,
  },
  "stat-products": {
    type: "stat-products",
    title: "Товари",
    iconKey: "products",
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
    roles: AM,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatClients withUsers={withUsers(role)} />,
  },
  "stat-wholesale": {
    type: "stat-wholesale",
    title: "Оптовики",
    iconKey: "wholesale",
    roles: AM,
    defaultSize: "1x1",
    allowedSizes: ["1x1", "2x1"],
    Render: ({ role }) => <StatWholesale withUsers={withUsers(role)} />,
  },
  "recent-orders": {
    type: "recent-orders",
    title: "Останні замовлення",
    iconKey: "orders",
    roles: ALL,
    defaultSize: "2x2",
    allowedSizes: ["2x1", "2x2", "3x1", "4x2"],
    Render: () => <RecentOrders />,
  },
  "sales-summary": {
    type: "sales-summary",
    title: "Продажі за місяць",
    iconKey: "money",
    roles: ALL,
    defaultSize: "2x1",
    allowedSizes: ["2x1", "3x1", "4x1"],
    Render: () => <SalesSummary />,
  },
  "revenue-chart": {
    type: "revenue-chart",
    title: "Оборот по торгових",
    iconKey: "chart",
    roles: AM,
    defaultSize: "4x1",
    allowedSizes: ["2x2", "4x1", "4x2"],
    Render: () => <RevenueChart />,
  },
};

export const WIDGET_LIST = Object.values(WIDGET_REGISTRY);

export function widgetsForRole(role: AdminRole): WidgetDef[] {
  return WIDGET_LIST.filter((w) => w.roles.includes(role));
}

export function isKnownWidget(type: string): type is WidgetType {
  return type in WIDGET_REGISTRY;
}
