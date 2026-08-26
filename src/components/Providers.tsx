"use client";

import { SessionProvider } from "next-auth/react";
import { useEffect } from "react";
import WebstatsTracker from "@/components/webstats/WebstatsTracker";
import DeploymentWatcher from "@/components/DeploymentWatcher";

function EnableActiveStates() {
  useEffect(() => {
    // iOS Safari requires a touchstart listener on the document
    // for :active CSS pseudo-class to work on touch events
    document.addEventListener("touchstart", function () {}, { passive: true });
  }, []);
  return null;
}

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <EnableActiveStates />
      <WebstatsTracker />
      {/* Нічого не рендерить: стежить, щоб застосунок-PWA не жив на старій
          збірці, поки його не вимкнуть і не ввімкнуть руками. */}
      <DeploymentWatcher />
      {children}
    </SessionProvider>
  );
}
