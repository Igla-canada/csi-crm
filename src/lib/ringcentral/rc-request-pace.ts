import "server-only";

/**
 * Global pacing for RingCentral REST calls made from this Node process.
 * RingCentral usage plans are tight on **Heavy** (~10 req / 60s per extension); bursts from
 * call-log sync + extension active-calls + other `platform.get` paths must share one throttle.
 *
 * Override with `RC_SYNC_MIN_REQUEST_INTERVAL_MS` (0–30000). See:
 * https://community.ringcentral.com/developer-platform-apis-integrations-5/what-to-do-if-your-application-is-receiving-a-429-rate-limit-error-message-9557
 */
function readMinIntervalMs(): number {
  const raw = process.env.RC_SYNC_MIN_REQUEST_INTERVAL_MS?.trim();
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0) return Math.min(n, 30_000);
  }
  return 900;
}

let lastRequestEndedAt = 0;

export async function paceBeforeRingCentralRestCall(): Promise<void> {
  const minI = readMinIntervalMs();
  const now = Date.now();
  const wait = lastRequestEndedAt + minI - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export function markRingCentralRestCallDone(): void {
  lastRequestEndedAt = Date.now();
}

/**
 * Parses `Retry-After` (seconds as integer, or HTTP-date). Returns milliseconds to wait, capped.
 */
export function retryAfterDelayMsFromHeaders(headers: Headers, capMs = 120_000): number | null {
  const ra = headers.get("retry-after");
  if (!ra) return null;
  const s = ra.trim();
  const sec = Number.parseInt(s, 10);
  if (Number.isFinite(sec) && sec >= 0 && /^\d+$/.test(s)) {
    return Math.min(sec * 1000, capMs);
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) {
    const delta = t - Date.now();
    if (delta > 0) return Math.min(delta, capMs);
  }
  return null;
}
