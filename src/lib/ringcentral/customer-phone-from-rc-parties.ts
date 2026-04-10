import "server-only";

import { CallDirection } from "@/lib/db";

const MIN_DIGITS_LOOKUP = 7;

export type RcPhoneEndpoint = {
  phoneNumber?: string;
  extensionNumber?: string;
  name?: string;
  /** Present on RingCentral “internal” legs; external PSTN parties usually omit this. */
  extensionId?: string;
};

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function rawPartyDial(p: RcPhoneEndpoint | undefined): string {
  if (!p) return "";
  const tel = String(p.phoneNumber ?? "").trim();
  if (tel) return tel;
  return String(p.extensionNumber ?? "").trim();
}

function normalizeUsLookup(raw: string): { lookup: string; callLog10: string | null } {
  let d = digitsOnly(raw);
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return { lookup: d, callLog10: d };
  if (d.length >= MIN_DIGITS_LOOKUP) return { lookup: d, callLog10: null };
  if (d.length >= 3 && d.length < MIN_DIGITS_LOOKUP) return { lookup: d, callLog10: null };
  return { lookup: "", callLog10: null };
}

function endpointHasRingCentralExtensionId(p: RcPhoneEndpoint | undefined): boolean {
  if (!p || typeof p !== "object") return false;
  return Boolean(String(p.extensionId ?? "").trim());
}

/**
 * Pick the customer-facing number for dock / call cards. RingCentral often marks the company/extension
 * endpoint with `extensionId` on `from` or `to`; the external caller/callee usually has no `extensionId`.
 * Prefer that side on inbound so we do not show the office DID when the caller is on the other field.
 */
export function pickCustomerPhoneFromRcFromTo(
  direction: CallDirection,
  from: RcPhoneEndpoint | undefined,
  to: RcPhoneEndpoint | undefined,
): { digits: string; callLog10: string | null; name: string | null } | null {
  const outbound = direction === CallDirection.OUTBOUND;
  const ordered: Array<{ ep: RcPhoneEndpoint | undefined; sortOrder: number }> = outbound
    ? [
        { ep: to, sortOrder: 0 },
        { ep: from, sortOrder: 1 },
      ]
    : [
        { ep: from, sortOrder: 0 },
        { ep: to, sortOrder: 1 },
      ];

  type Cand = {
    digits: string;
    callLog10: string | null;
    name: string | null;
    internalRank: number;
    sortOrder: number;
  };

  const cands: Cand[] = [];
  for (const { ep, sortOrder } of ordered) {
    const raw = rawPartyDial(ep);
    if (!raw) continue;
    const { lookup, callLog10 } = normalizeUsLookup(raw);
    if (lookup.length < 3) continue;
    const name = ep?.name?.trim() ? ep.name.trim() : null;
    cands.push({
      digits: lookup,
      callLog10,
      name,
      internalRank: endpointHasRingCentralExtensionId(ep) ? 1 : 0,
      sortOrder,
    });
  }

  if (!cands.length) return null;

  cands.sort((a, b) => {
    if (a.internalRank !== b.internalRank) return a.internalRank - b.internalRank;
    return a.sortOrder - b.sortOrder;
  });

  const best = cands[0]!;
  return { digits: best.digits, callLog10: best.callLog10, name: best.name };
}
