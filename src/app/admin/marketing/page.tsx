import { Suspense } from "react";
import MarketingScreen from "./MarketingScreen";

export const metadata = { title: "Робота з базою" };
export const dynamic = "force-dynamic";

export default function MarketingPage() {
  return (
    <Suspense fallback={null}>
      <MarketingScreen />
    </Suspense>
  );
}
