"use client";

/** Читає параметри адреси й віддає їх екрану. Окремо — заради Suspense. */

import { useSearchParams } from "next/navigation";
import AssistantScreen from "./AssistantScreen";

export default function AssistantEntry({ section = "sales" }: { section?: "sales" | "driver" }) {
  const params = useSearchParams();
  return (
    <AssistantScreen
      section={section}
      threadId={params.get("t")}
      clientId={params.get("client")}
      clientName={params.get("name")}
      repId={params.get("rep")}
    />
  );
}
