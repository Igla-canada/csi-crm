import { CallDirection } from "@/lib/db";

export function parseCallDirectionSearchParam(raw: string | undefined | null): CallDirection | undefined {
  const u = String(raw ?? "").toUpperCase();
  if (u === "INBOUND") return CallDirection.INBOUND;
  if (u === "OUTBOUND") return CallDirection.OUTBOUND;
  return undefined;
}
