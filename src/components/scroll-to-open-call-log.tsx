"use client";

import { useEffect } from "react";

/** After navigation from Call history, scroll the matching timeline card into view. */
export function ScrollToOpenCallLog({ callLogId }: { callLogId: string | null }) {
  useEffect(() => {
    const id = callLogId?.trim();
    if (!id) return;
    const elId = `call-log-${id}`;
    const t = window.setTimeout(() => {
      document.getElementById(elId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => clearTimeout(t);
  }, [callLogId]);
  return null;
}
