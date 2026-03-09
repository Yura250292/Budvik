"use client";

import dynamic from "next/dynamic";

const AiChatWidget = dynamic(() => import("@/components/ai/AiChatWidget"), { ssr: false });

export default function AiChatWidgetLoader() {
  return <AiChatWidget />;
}
