"use client";

import { SessionProvider } from "next-auth/react";
import { useEffect } from "react";

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
      {children}
    </SessionProvider>
  );
}
