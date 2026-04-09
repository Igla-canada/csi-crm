/** Shared resolver (no server-only) for Log a Call client + CRM import/save. */

export type ProductServiceResolveRow = {
  code: string;
  label: string;
  matchTerms: string;
  active: boolean;
};

export function parseProductMatchTerms(raw: string): string[] {
  return String(raw ?? "")
    .split(/[,;\n]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function generalCode(rows: ProductServiceResolveRow[]): string {
  const g = rows.find((o) => o.code === "GENERAL" && o.active);
  return g?.code ?? rows.find((o) => o.active)?.code ?? "GENERAL";
}

/**
 * Resolves a stored product/service code from an optional explicit value (code or label) plus free text.
 * When explicit does not match any active option, falls back to keyword match on haystack, then GENERAL.
 */
export function resolveProductServiceCodeFromHaystack(
  explicitValue: string,
  haystack: string,
  options: ProductServiceResolveRow[],
): string {
  const active = options.filter((o) => o.active);
  const gen = generalCode(active);
  const trim = explicitValue.trim();

  if (trim) {
    for (const o of active) {
      if (o.code.toLowerCase() === trim.toLowerCase()) return o.code;
    }
    for (const o of active) {
      if (o.label.trim().toLowerCase() === trim.toLowerCase()) return o.code;
    }
  }

  const h = haystack.toLowerCase();
  const candidates: { code: string; len: number }[] = [];
  for (const o of active) {
    const terms = new Set<string>();
    for (const t of parseProductMatchTerms(o.matchTerms)) terms.add(t);
    const lbl = o.label.trim().toLowerCase();
    if (lbl.length >= 2) terms.add(lbl);
    for (const term of terms) {
      if (term.length >= 2 && h.includes(term)) {
        candidates.push({ code: o.code, len: term.length });
      }
    }
  }
  if (candidates.length) {
    candidates.sort((a, b) => b.len - a.len);
    return candidates[0].code;
  }

  return gen;
}
