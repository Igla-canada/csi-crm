"use client";

import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CALL_RESULT_ACCENT_KEYS,
  CALL_RESULT_ACCENT_META,
  normalizeStoredAccentHex,
  type CallResultAccentKey,
} from "@/lib/call-result-accents";

/** Fired when preset or custom hex changes (for live previews; not a save). */
export type CallResultAccentChangeHandler = (key: CallResultAccentKey, hex: string) => void;

function Swatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-block shrink-0 rounded-md border border-black/15 shadow-sm ring-1 ring-black/[0.06]",
        className,
      )}
      style={{ backgroundColor: hex }}
      aria-hidden
    />
  );
}

type CallResultAccentPickerProps = {
  accentKeyName?: string;
  accentHexName?: string;
  defaultAccentKey: CallResultAccentKey;
  /** Saved custom color, or null to use preset only. */
  defaultAccentHex: string | null;
  /** Current preset + hex string (empty = preset only). */
  onAccentChange?: CallResultAccentChangeHandler;
  className?: string;
};

export function CallResultAccentPicker({
  accentKeyName = "accentKey",
  accentHexName = "accentHex",
  defaultAccentKey,
  defaultAccentHex,
  onAccentChange,
  className,
}: CallResultAccentPickerProps) {
  const [open, setOpen] = useState(false);
  const [presetKey, setPresetKey] = useState<CallResultAccentKey>(defaultAccentKey);
  const [hexSubmit, setHexSubmit] = useState(() => normalizeStoredAccentHex(defaultAccentHex) ?? "");
  const [mounted, setMounted] = useState(false);
  const [panelBox, setPanelBox] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setPresetKey(defaultAccentKey);
    setHexSubmit(normalizeStoredAccentHex(defaultAccentHex) ?? "");
  }, [defaultAccentKey, defaultAccentHex]);

  useEffect(() => {
    onAccentChange?.(presetKey, hexSubmit);
  }, [presetKey, hexSubmit, onAccentChange]);

  const updatePanelPosition = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === "undefined") return;

    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;
    const gap = 6;
    const idealMax = Math.min(vh * 0.85, 520);

    const width = Math.min(360, Math.max(Math.round(r.width), 280));
    let left = r.left;
    if (left + width > vw - margin) left = Math.max(margin, vw - margin - width);

    const panel = panelRef.current;
    const measuredH = panel?.offsetHeight ?? 0;
    const estimateH = 380;
    const contentH = measuredH > 0 ? measuredH : estimateH;

    const spaceBelow = vh - r.bottom - margin - gap;
    const spaceAbove = r.top - margin - gap;

    // Near the bottom of the viewport: flip up only when there’s more usable room above than below.
    const minComfortBelow = 280;
    const placeAbove =
      spaceBelow < minComfortBelow && spaceAbove > spaceBelow && spaceAbove >= 100;

    let top: number;
    let maxHeight: number;

    if (placeAbove) {
      maxHeight = Math.min(idealMax, spaceAbove);
      const heightUsed = Math.min(contentH, maxHeight);
      top = r.top - heightUsed - gap;
      if (top < margin) top = margin;
    } else {
      maxHeight = Math.min(idealMax, spaceBelow);
      top = r.bottom + gap;
      const heightUsed = Math.min(contentH, maxHeight);
      if (top + heightUsed > vh - margin) {
        top = Math.max(margin, vh - margin - heightUsed);
      }
    }

    setPanelBox({ top, left, width, maxHeight });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setPanelBox(null);
      return;
    }
    updatePanelPosition();
    const id = window.requestAnimationFrame(() => updatePanelPosition());
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const displayHex = hexSubmit || CALL_RESULT_ACCENT_META[presetKey].calendarHex;
  const triggerLabel = hexSubmit ? `Custom ${hexSubmit}` : CALL_RESULT_ACCENT_META[presetKey].label;
  const colorInputValue =
    hexSubmit && /^#[0-9A-Fa-f]{6}$/i.test(hexSubmit)
      ? hexSubmit
      : CALL_RESULT_ACCENT_META[presetKey].calendarHex;

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      <input type="hidden" name={accentKeyName} value={presetKey} />
      <input type="hidden" name={accentHexName} value={hexSubmit} />
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-[200px] items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm shadow-sm outline-none ring-slate-200/80 transition hover:bg-slate-50 focus:ring-2 focus:ring-[#1e5ea8]/40"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Call result color: ${triggerLabel}`}
      >
        <Swatch hex={displayHex} className="h-6 w-6" />
        <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{triggerLabel}</span>
        <ChevronDown
          className={clsx("h-4 w-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>
      {open && mounted && panelBox && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={panelRef}
              className="overflow-y-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-xl ring-1 ring-black/5"
              style={{
                position: "fixed",
                top: panelBox.top,
                left: panelBox.left,
                width: panelBox.width,
                maxHeight: panelBox.maxHeight,
                zIndex: 9999,
              }}
              role="dialog"
              aria-label="Choose call result color"
            >
              <p className="px-2 py-1.5 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Presets
              </p>
              <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                {CALL_RESULT_ACCENT_KEYS.map((key) => {
                  const m = CALL_RESULT_ACCENT_META[key];
                  const selected = !hexSubmit && key === presetKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        setPresetKey(key);
                        setHexSubmit("");
                        setOpen(false);
                      }}
                      className={clsx(
                        "flex items-center gap-2.5 rounded-xl border px-2 py-2 text-left text-xs transition",
                        selected
                          ? "border-[#1e5ea8] bg-[#1e5ea8]/6 ring-2 ring-[#1e5ea8]/25"
                          : "border-transparent hover:bg-slate-50",
                      )}
                    >
                      <Swatch hex={m.calendarHex} className="h-8 w-8 rounded-lg" />
                      <span className="min-w-0 flex-1 font-medium leading-snug text-slate-800">{m.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 border-t border-slate-100 pt-3">
                <p className="px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-slate-400">
                  Custom color
                </p>
                <div className="flex flex-wrap items-center gap-3 px-2 py-2">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                    <span
                      className="relative h-10 w-14 overflow-hidden rounded-lg border border-slate-200 shadow-sm ring-1 ring-black/5"
                      style={{ backgroundColor: displayHex }}
                    >
                      <input
                        type="color"
                        value={colorInputValue}
                        onChange={(e) => {
                          setHexSubmit(e.target.value.toLowerCase());
                        }}
                        className="absolute inset-0 h-[200%] w-[200%] -translate-x-1/4 -translate-y-1/4 cursor-pointer opacity-0"
                        aria-label="Pick custom color"
                      />
                    </span>
                    <span className="tabular-nums text-slate-600">{hexSubmit || "Preset only"}</span>
                  </label>
                  {hexSubmit ? (
                    <button
                      type="button"
                      onClick={() => setHexSubmit("")}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Use preset only
                    </button>
                  ) : null}
                </div>
                <p className="px-2 pb-1 text-[0.7rem] leading-relaxed text-slate-500">
                  Custom colors override the preset for badges, dropdowns, and the calendar stripe. Presets still set the
                  fallback if you clear custom.
                </p>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
