import "server-only";

/**
 * Build the API-relative path RingCentral `platform.get()` expects for recording binary.
 * Handles `contentUri`, `uri` (absolute or relative), and `id`-only refs from DB or RC payloads.
 */
export function recordingPathFromStoredRef(hit: unknown): string {
  if (!hit || typeof hit !== "object" || Array.isArray(hit)) return "";
  const o = hit as Record<string, unknown>;
  let path = String(o.contentUri ?? "").trim();
  if (!path) path = String(o.uri ?? "").trim();
  if (path.startsWith("http://") || path.startsWith("https://")) {
    try {
      const u = new URL(path);
      return u.pathname + u.search;
    } catch {
      return path;
    }
  }
  if (path && !path.startsWith("/")) path = `/${path}`;
  if (!path) {
    const id = String(o.id ?? "").trim();
    if (id) {
      return `/restapi/v1.0/account/~/recording/${encodeURIComponent(id)}/content`;
    }
  }
  return path;
}

export function stableRecordingIdForPath(path: string, explicitId: string): string {
  const id = explicitId.trim();
  if (id) return id;
  const m = path.match(/\/recording\/([^/?#]+)/);
  if (m?.[1]) return m[1];
  const compact = path.replace(/\W/g, "") || "recording";
  return `rc-${compact.slice(-48)}`;
}
