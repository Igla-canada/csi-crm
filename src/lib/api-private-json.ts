import { NextResponse } from "next/server";

/** Avoid CDN / Data Cache serving a stale 401 or empty session for authenticated GET APIs. */
const CACHE_CONTROL = "private, no-store, max-age=0, must-revalidate";

export function jsonPrivate(data: unknown, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", CACHE_CONTROL);
  return NextResponse.json(data, { ...init, headers });
}
