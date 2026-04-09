/**
 * Call-result color presets — stored on `CallResultOption.accentKey` for consistent UI + future calendar.
 * Optional `CallResultOption.accentHex` overrides the preset with an exact color everywhere.
 * Use `calendarHex` / `resolveCallResultDisplayHex` when you render outside Tailwind.
 */

import type { CSSProperties } from "react";

export const CALL_RESULT_ACCENT_KEYS = [
  "slate",
  "sky",
  "cyan",
  "indigo",
  "violet",
  "amber",
  "orange",
  "emerald",
  "lime",
  "rose",
] as const;

export type CallResultAccentKey = (typeof CALL_RESULT_ACCENT_KEYS)[number];

export function isCallResultAccentKey(v: string): v is CallResultAccentKey {
  return (CALL_RESULT_ACCENT_KEYS as readonly string[]).includes(v);
}

export const CALL_RESULT_ACCENT_META: Record<
  CallResultAccentKey,
  { label: string; badge: string; select: string; calendarHex: string }
> = {
  slate: {
    label: "Neutral slate",
    badge: "bg-slate-100 text-slate-800 ring-slate-200",
    select: "border-slate-300 bg-white text-slate-900 ring-slate-200/80",
    calendarHex: "#64748b",
  },
  sky: {
    label: "Sky (quotes / info)",
    badge: "bg-sky-100 text-sky-900 ring-sky-200",
    select: "border-sky-400/50 bg-sky-50/90 text-sky-950 ring-sky-300/60",
    calendarHex: "#0284c7",
  },
  cyan: {
    label: "Cyan (booked / confirmed)",
    badge: "bg-cyan-100 text-cyan-950 ring-cyan-200",
    select: "border-cyan-400/50 bg-cyan-50/90 text-cyan-950 ring-cyan-300/60",
    calendarHex: "#0891b2",
  },
  indigo: {
    label: "Indigo",
    badge: "bg-indigo-100 text-indigo-950 ring-indigo-200",
    select: "border-indigo-400/45 bg-indigo-50/90 text-indigo-950 ring-indigo-300/50",
    calendarHex: "#4f46e5",
  },
  violet: {
    label: "Violet (support)",
    badge: "bg-violet-100 text-violet-950 ring-violet-200",
    select: "border-violet-400/45 bg-violet-50/90 text-violet-950 ring-violet-300/50",
    calendarHex: "#7c3aed",
  },
  amber: {
    label: "Amber (callback / follow-up)",
    badge: "bg-amber-100 text-amber-950 ring-amber-300",
    select: "border-amber-400/60 bg-amber-50/95 text-amber-950 ring-amber-300/70",
    calendarHex: "#d97706",
  },
  orange: {
    label: "Orange (follow-up alt)",
    badge: "bg-orange-100 text-orange-950 ring-orange-300",
    select: "border-orange-400/55 bg-orange-50/95 text-orange-950 ring-orange-300/65",
    calendarHex: "#ea580c",
  },
  emerald: {
    label: "Green (completed / won)",
    badge: "bg-emerald-100 text-emerald-950 ring-emerald-300",
    select: "border-emerald-400/50 bg-emerald-50/95 text-emerald-950 ring-emerald-300/60",
    calendarHex: "#059669",
  },
  lime: {
    label: "Lime",
    badge: "bg-lime-100 text-lime-950 ring-lime-300",
    select: "border-lime-400/50 bg-lime-50/95 text-lime-950 ring-lime-300/60",
    calendarHex: "#65a30d",
  },
  rose: {
    label: "Rose (no solution / risk)",
    badge: "bg-rose-100 text-rose-950 ring-rose-200",
    select: "border-rose-400/45 bg-rose-50/90 text-rose-950 ring-rose-300/50",
    calendarHex: "#e11d48",
  },
};

/** Fallback when `accentKey` is missing or unknown (legacy rows). */
export function defaultAccentForOutcomeCode(code: string): CallResultAccentKey {
  const map: Record<string, CallResultAccentKey> = {
    QUOTE_SENT: "sky",
    CALLBACK_NEEDED: "amber",
    BOOKED: "cyan",
    SUPPORT: "violet",
    NO_SOLUTION: "rose",
    COMPLETED: "emerald",
    ARCHIVED: "slate",
    FOLLOW_UP: "orange",
  };
  return map[code] ?? "slate";
}

/** Default calendar colors for built-in booking type codes (custom codes fall back to slate). */
export function defaultAccentForBookingTypeCode(code: string): CallResultAccentKey {
  const map: Record<string, CallResultAccentKey> = {
    INSTALL: "indigo",
    INSPECTION: "sky",
    SUPPORT: "violet",
    QUOTE_VISIT: "amber",
    PHONE_CALL: "cyan",
  };
  return map[code] ?? "slate";
}

export function resolveBookingTypeAccentKey(
  stored: string | null | undefined,
  typeCode: string,
): CallResultAccentKey {
  if (stored && isCallResultAccentKey(stored)) return stored;
  return defaultAccentForBookingTypeCode(typeCode);
}

export function resolveBookingTypeDisplayHex(
  accentHex: string | null | undefined,
  accentKey: string | null | undefined,
  typeCode: string,
): string {
  const cleaned = normalizeStoredAccentHex(accentHex);
  if (cleaned) return cleaned;
  const key = resolveBookingTypeAccentKey(accentKey, typeCode);
  return CALL_RESULT_ACCENT_META[key].calendarHex;
}

/** Inline styles for CRM blocks on the bookings calendar. */
export function bookingCalendarBlockStyle(hex: string): CSSProperties {
  return {
    borderLeft: `3px solid ${hex}`,
    background: `color-mix(in srgb, ${hex} 22%, white)`,
    color: "#0f172a",
  };
}

export function resolveCallResultAccentKey(
  stored: string | null | undefined,
  outcomeCode: string,
): CallResultAccentKey {
  if (stored && isCallResultAccentKey(stored)) return stored;
  return defaultAccentForOutcomeCode(outcomeCode);
}

/** For writes: invalid values become slate. */
export function normalizeStoredAccentKey(v: string | null | undefined): CallResultAccentKey {
  if (v && isCallResultAccentKey(v)) return v;
  return "slate";
}

export function callResultBadgeClasses(key: CallResultAccentKey): string {
  return `${CALL_RESULT_ACCENT_META[key].badge} inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1`;
}

export function callResultSelectClasses(key: CallResultAccentKey): string {
  return `${CALL_RESULT_ACCENT_META[key].select} rounded-xl border px-2.5 py-1.5 text-xs font-semibold shadow-sm ring-1 outline-none focus:ring-2`;
}

export function callResultSelectClassesLg(key: CallResultAccentKey): string {
  return `${CALL_RESULT_ACCENT_META[key].select} w-full rounded-2xl border px-4 py-3 text-sm font-medium ring-1 outline-none focus:ring-2`;
}

export function callResultReportStripeStyle(key: CallResultAccentKey): { borderColor: string } {
  return { borderColor: CALL_RESULT_ACCENT_META[key].calendarHex };
}

function expandShortHex(s: string): string {
  const x = s.slice(1);
  if (x.length !== 3) return s;
  return `#${x[0]}${x[0]}${x[1]}${x[1]}${x[2]}${x[2]}`;
}

/** Normalize DB/user input to `#rrggbb` or null if invalid. */
export function normalizeStoredAccentHex(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) return expandShortHex(s).toLowerCase();
  return null;
}

export function resolveCallResultDisplayHex(
  accentHex: string | null | undefined,
  accentKey: string | null | undefined,
  outcomeCode: string,
): string {
  const cleaned = normalizeStoredAccentHex(accentHex);
  if (cleaned) return cleaned;
  const key = resolveCallResultAccentKey(accentKey, outcomeCode);
  return CALL_RESULT_ACCENT_META[key].calendarHex;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixWithWhite(hex: string, whiteAmount: number): { r: number; g: number; b: number } {
  const c = hexToRgb(hex);
  if (!c) return { r: 255, g: 255, b: 255 };
  const t = Math.min(1, Math.max(0, whiteAmount));
  return {
    r: Math.round(c.r * (1 - t) + 255 * t),
    g: Math.round(c.g * (1 - t) + 255 * t),
    b: Math.round(c.b * (1 - t) + 255 * t),
  };
}

function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const R = lin(rgb.r);
  const G = lin(rgb.g);
  const B = lin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastingTextForTintedBadge(hex: string): string {
  const mixed = mixWithWhite(hex, 0.76);
  return relativeLuminance(mixed) > 0.55 ? "#0f172a" : "#fafafa";
}

const BASE_BADGE =
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-black/[0.08]";

export function callResultBadgePresentation(
  accentHex: string | null | undefined,
  accentKey: string | null | undefined,
  outcomeCode: string,
): { className: string; style?: CSSProperties } {
  const hex = normalizeStoredAccentHex(accentHex);
  if (hex) {
    const fg = contrastingTextForTintedBadge(hex);
    return {
      className: BASE_BADGE,
      style: {
        background: `color-mix(in srgb, ${hex} 24%, white)`,
        color: fg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 45%, transparent)`,
      },
    };
  }
  const key = resolveCallResultAccentKey(accentKey, outcomeCode);
  return { className: callResultBadgeClasses(key) };
}

export function bookingTypeBadgePresentation(
  accentHex: string | null | undefined,
  accentKey: string | null | undefined,
  typeCode: string,
): { className: string; style?: CSSProperties } {
  const hex = normalizeStoredAccentHex(accentHex);
  if (hex) {
    const fg = contrastingTextForTintedBadge(hex);
    return {
      className: BASE_BADGE,
      style: {
        background: `color-mix(in srgb, ${hex} 24%, white)`,
        color: fg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 45%, transparent)`,
      },
    };
  }
  const key = resolveBookingTypeAccentKey(accentKey, typeCode);
  return { className: callResultBadgeClasses(key) };
}

export function callResultSelectPresentation(
  accentHex: string | null | undefined,
  accentKey: string | null | undefined,
  outcomeCode: string,
  size: "sm" | "lg",
): { className: string; style?: CSSProperties } {
  const hex = normalizeStoredAccentHex(accentHex);
  const baseSm =
    "rounded-xl border px-2.5 py-1.5 text-xs font-semibold shadow-sm ring-1 outline-none focus:ring-2 focus:ring-[#1e5ea8]/40";
  const baseLg =
    "w-full rounded-2xl border px-4 py-3 text-sm font-medium ring-1 outline-none focus:ring-2 focus:ring-[#1e5ea8]/40";
  const base = size === "lg" ? baseLg : baseSm;
  if (hex) {
    const fg = contrastingTextForTintedBadge(hex);
    return {
      className: base,
      style: {
        borderColor: `color-mix(in srgb, ${hex} 55%, #cbd5e1)`,
        background: `color-mix(in srgb, ${hex} 14%, white)`,
        color: fg,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${hex} 22%, transparent)`,
      },
    };
  }
  const key = resolveCallResultAccentKey(accentKey, outcomeCode);
  return {
    className: size === "lg" ? callResultSelectClassesLg(key) : callResultSelectClasses(key),
  };
}
