import { Suspense } from "react";
import AdminRequestsScreen from "./AdminRequestsScreen";

export const metadata = { title: "Заявки торгових" };
export const dynamic = "force-dynamic";

export default function AdminRequestsPage() {
  return (
    <Suspense fallback={null}>
      <AdminRequestsScreen />
    </Suspense>
  );
}
