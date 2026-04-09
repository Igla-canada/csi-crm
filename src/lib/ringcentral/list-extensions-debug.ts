import "server-only";

import { getRingCentralPlatform } from "@/lib/ringcentral/platform";

export type ExtensionListRow = {
  id: string;
  extensionNumber: string | null;
  name: string | null;
  type: string | null;
};

type RcExtensionListResponse = {
  records?: Array<{
    id?: string | number;
    extensionNumber?: string | number;
    name?: string;
    type?: string;
  }>;
  paging?: { page?: number; totalPages?: number; perPage?: number };
};

/**
 * Lists account extensions so admins can set `RINGCENTRAL_ACTIVE_CALLS_EXTENSION_ID` to the API `id` (not ext. number).
 */
export async function listRingCentralExtensionsForDebug(): Promise<ExtensionListRow[]> {
  const platform = await getRingCentralPlatform();
  const out: ExtensionListRow[] = [];
  let page = 1;
  const perPage = 100;
  let totalPages = 1;

  do {
    const res = await platform.get(
      `/restapi/v1.0/account/~/extension?${new URLSearchParams({ page: String(page), perPage: String(perPage) })}`,
    );
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`RingCentral extension list failed (${res.status}): ${t.slice(0, 240)}`);
    }
    const body = (await res.json()) as RcExtensionListResponse;
    const records = body.records ?? [];
    for (const r of records) {
      const id = String(r.id ?? "").trim();
      if (!id) continue;
      out.push({
        id,
        extensionNumber: r.extensionNumber != null ? String(r.extensionNumber) : null,
        name: r.name?.trim() ? r.name.trim() : null,
        type: r.type?.trim() ? r.type.trim() : null,
      });
    }
    const p = body.paging;
    totalPages = typeof p?.totalPages === "number" && p.totalPages > 0 ? p.totalPages : 1;
    page += 1;
  } while (page <= totalPages);

  return out;
}
