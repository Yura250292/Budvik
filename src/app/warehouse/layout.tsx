import type { Metadata, Viewport } from "next";
import WarehouseGate from "@/components/warehouse/WarehouseGate";
import WarehouseShell from "@/components/warehouse/WarehouseShell";

export const metadata: Metadata = {
  title: "Budvik — Склад",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function WarehouseLayout({ children }: LayoutProps<"/warehouse">) {
  return (
    <WarehouseGate>
      <WarehouseShell>{children}</WarehouseShell>
    </WarehouseGate>
  );
}
