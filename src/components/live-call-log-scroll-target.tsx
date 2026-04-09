"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Scrolls into view once (e.g. after opening Log a Call from the live call dock). */
export function LiveCallLogScrollTarget({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);
  return (
    <div ref={ref} id="live-call-log" className="scroll-mt-6">
      {children}
    </div>
  );
}
