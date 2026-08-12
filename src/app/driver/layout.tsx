import type { Metadata, Viewport } from "next";
import DriverGate from "@/components/driver/DriverGate";
import DriverShell from "@/components/driver/DriverShell";

export const metadata: Metadata = {
  title: "Budvik — Водій",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function DriverLayout({ children }: LayoutProps<"/driver">) {
  return (
    <DriverGate>
      <DriverShell>{children}</DriverShell>
    </DriverGate>
  );
}
