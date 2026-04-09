import "server-only";

/**
 * Classify errors from `fetchExtensionActiveCalls` (message shape:
 * `RingCentral active-calls failed (STATUS): …body…`).
 */
export function parseExtensionActiveCallsFailure(message: string): {
  upstreamStatus: number | null;
  rateLimited: boolean;
  extensionIdNotFound: boolean;
} {
  const m = message.match(/RingCentral active-calls failed \((\d+)\):\s*([\s\S]*)/);
  const parsed = m?.[1] ? parseInt(m[1], 10) : NaN;
  let upstreamStatus = Number.isFinite(parsed) ? parsed : null;
  const tail = (m?.[2] ?? "").toLowerCase();
  const all = `${message} ${tail}`.toLowerCase();

  const looksLikeRate =
    /\brequest rate exceeded\b/.test(all) ||
    /\btoo many requests\b/.test(all) ||
    /\brate[\s_-]*limit/.test(all) ||
    /\bquota exceeded\b/.test(all) ||
    /\bthrottl/.test(all) ||
    /\binbound_rate_limit\b/.test(all) ||
    /\boutbound_rate_limit\b/.test(all) ||
    /\bcmn[-_]429\b/.test(all) ||
    /\bratelimit\b/.test(all);

  const rateLimited =
    upstreamStatus === 429 ||
    (upstreamStatus === 503 && looksLikeRate) ||
    looksLikeRate;

  const extensionIdNotFound =
    /parameter\s*\[extensionId\]\s*is not found|extensionid.*not found/i.test(all);

  if (extensionIdNotFound && (upstreamStatus === 0 || upstreamStatus === null)) {
    upstreamStatus = 404;
  }

  return { upstreamStatus, rateLimited, extensionIdNotFound };
}

/** True when every path error looks like RingCentral throttling (multi-extension poll all 429/502 rate). */
export function aggregatePathErrorsAreAllRateLimited(pathErrors: string[]): boolean {
  if (pathErrors.length === 0) return false;
  return pathErrors.every((msg) => parseExtensionActiveCallsFailure(msg).rateLimited);
}
