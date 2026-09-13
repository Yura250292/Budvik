import { Suspense } from "react";
import AdminFeedScreen from "./AdminFeedScreen";

export const metadata = { title: "Стрічка подій" };
export const dynamic = "force-dynamic";

export default function AdminFeedPage() {
  return (
    <Suspense fallback={null}>
      <AdminFeedScreen />
    </Suspense>
  );
}
