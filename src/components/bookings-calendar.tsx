"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  max,
  min,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Link2,
  Link2Off,
  Loader2,
  Trash2,
  X,
} from "lucide-react";

import {
  deleteAppointmentAction,
  quickUpdateAppointmentTimesAction,
  rescheduleAppointmentAction,
  rescheduleGoogleCalendarEventAction,
} from "@/app/actions";
import { AppointmentQuickCreateDialog } from "@/components/appointment-quick-create-dialog";
import {
  BOOKING_FROM_CALL_STORAGE_KEY,
  defaultNextBookingStart,
  peekBookingFromCall,
  type BookingFromCallPayload,
} from "@/lib/booking-from-call";
import type { AppointmentFormClientOption } from "@/lib/crm-types";
import { bookingCalendarBlockStyle } from "@/lib/call-result-accents";
import { cn } from "@/lib/crm-shared";
import { normalizePhone } from "@/lib/phone";

/** Full 24-hour day column (midnight–11 PM) so overnight bookings (e.g. until 3 AM) stay visible. */
const HOUR_START = 0;
const HOUR_END = 24;
const PX_PER_HOUR = 52;
const GRID_HEIGHT = (HOUR_END - HOUR_START) * PX_PER_HOUR;

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type ViewMode = "day" | "week" | "month";

export type BookingsCalendarAppointment = {
  id: string;
  clientId: string;
  title: string;
  type: string;
  /** Display label from BookingTypeOption when known. */
  typeLabel: string;
  /** Resolved hex for calendar block styling. */
  typeColorHex: string;
  status: string;
  resourceKey: string;
  googleSyncStatus: string;
  capacitySlot: string;
  startAt: string;
  endAt: string;
  clientName: string;
  /** Primary phone when present (for quick-look popover / tel link). */
  clientPhone: string | null;
  createdByName: string;
  googleEventId: string | null;
  notes: string | null;
  /** Digits-only deposit (CRM-only). */
  depositText: string | null;
  /** Originating call log when the booking was created from a call. */
  callLogId: string | null;
};

type GoogleEventDTO = {
  id: string;
  summary: string;
  start: string;
  end: string;
  allDay: boolean;
  htmlLink?: string;
  colorId?: string | null;
};

type CalendarSaveBanner =
  | { kind: "hidden" }
  | { kind: "saving"; message: string }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

function overlapsDay(rangeStart: Date, rangeEnd: Date, day: Date): boolean {
  const ds = startOfDay(day);
  const de = endOfDay(day);
  return rangeEnd >= ds && rangeStart <= de;
}

function layoutTimedBlock(
  day: Date,
  rangeStart: Date,
  rangeEnd: Date,
): { top: number; height: number } | null {
  const colStart = startOfDay(day);
  const colEnd = endOfDay(day);
  const visStart = max([rangeStart, colStart]);
  const visEnd = min([rangeEnd, colEnd]);
  if (visEnd.getTime() <= visStart.getTime()) return null;
  const startH = visStart.getHours() + visStart.getMinutes() / 60 + visStart.getSeconds() / 3600;
  const endH = visEnd.getHours() + visEnd.getMinutes() / 60 + visEnd.getSeconds() / 3600;
  const clipStart = Math.max(startH, HOUR_START);
  const clipEnd = Math.min(endH, HOUR_END);
  if (clipEnd <= clipStart) return null;
  return {
    top: (clipStart - HOUR_START) * PX_PER_HOUR,
    height: Math.max((clipEnd - clipStart) * PX_PER_HOUR, 22),
  };
}

function yToClippedDayMinutes(y: number): number {
  const intoGrid = (y / PX_PER_HOUR) * 60;
  const snapped = Math.round(intoGrid / 15) * 15;
  let total = HOUR_START * 60 + snapped;
  total = Math.max(HOUR_START * 60, Math.min(HOUR_END * 60 - 15, total));
  return total;
}

function dayMinutesToDate(day: Date, minsFromMidnight: number): Date {
  const d = startOfDay(day);
  d.setHours(Math.floor(minsFromMidnight / 60), minsFromMidnight % 60, 0, 0);
  return d;
}

function sameInstant(isoA: string, isoB: string): boolean {
  const ta = new Date(isoA).getTime();
  const tb = new Date(isoB).getTime();
  return !Number.isNaN(ta) && ta === tb;
}

function crmGoogleSyncTitleSuffix(status: string): string {
  if (status === "FAILED") {
    return " · Google sync failed (try Full edit → Save, or Settings → Google)";
  }
  if (status === "PENDING") {
    return " · Google sync pending…";
  }
  return "";
}

/** Day column roots in week/day grid — used for cross-day drag/drop. */
function calendarColumnElFromPoint(clientX: number, clientY: number): HTMLElement | null {
  try {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (el instanceof HTMLElement && el.dataset.calendarCol) {
        return el;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function monthCellElFromPoint(clientX: number, clientY: number): HTMLElement | null {
  try {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (!(el instanceof HTMLElement)) continue;
      let cur: HTMLElement | null = el;
      while (cur) {
        if (cur.dataset.monthDay) return cur;
        cur = cur.parentElement;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function yClampedInColumn(clientY: number, colRect: DOMRect, offsetY: number, blockHeight: number): number {
  let topWithin = clientY - colRect.top - offsetY;
  return Math.max(0, Math.min(GRID_HEIGHT - blockHeight, topWithin));
}

function ghostFixedRect(
  colEl: HTMLElement,
  clientY: number,
  offsetY: number,
  blockHeight: number,
): { top: number; left: number; width: number } {
  const rect = colEl.getBoundingClientRect();
  const topWithin = yClampedInColumn(clientY, rect, offsetY, blockHeight);
  return {
    top: rect.top + topWithin,
    left: rect.left + 2,
    width: Math.max(72, rect.width - 4),
  };
}

/** Build new start Date from pointer position over a marked day column. */
/** Keep the booking detail card on-screen; flip above the click when the bottom is cramped. */
function bookingDetailPopoverStyle(clientX: number, clientY: number): CSSProperties {
  if (typeof window === "undefined") {
    return { left: Math.max(12, clientX - 160), top: clientY + 10 };
  }
  const margin = 12;
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popW = Math.min(vw - 2 * margin, 320);
  let left = Math.max(margin, Math.min(clientX - popW / 2, vw - popW - margin));

  const spaceBelow = vh - clientY - margin - gap;
  const spaceAbove = clientY - margin - gap;
  const minComfort = 220;
  const openAbove = spaceBelow < minComfort && spaceAbove > spaceBelow;

  if (openAbove) {
    return {
      left,
      top: clientY - gap,
      transform: "translateY(-100%)",
      maxHeight: Math.max(120, spaceAbove),
      overflowY: "auto",
    };
  }
  return {
    left,
    top: clientY + gap,
    maxHeight: Math.max(120, spaceBelow),
    overflowY: "auto",
  };
}

function newStartFromPointerInColumn(
  colEl: HTMLElement,
  clientY: number,
  offsetY: number,
  blockHeight: number,
  durationMins: number,
): Date | null {
  const key = colEl.dataset.calendarCol;
  if (!key) return null;
  const parsed = parse(key, "yyyy-MM-dd", new Date());
  if (Number.isNaN(parsed.getTime())) return null;
  const targetDay = startOfDay(parsed);
  const rect = colEl.getBoundingClientRect();
  const topWithin = yClampedInColumn(clientY, rect, offsetY, blockHeight);
  const rawMins = yToClippedDayMinutes(topWithin);
  const maxStartMins = HOUR_END * 60 - durationMins;
  const clampedStartMins = Math.max(HOUR_START * 60, Math.min(rawMins, maxStartMins));
  return dayMinutesToDate(targetDay, clampedStartMins);
}

type CrmAptDragState = {
  apt: BookingsCalendarAppointment;
  offsetY: number;
  pointerId: number;
  durationMins: number;
  blockHeight: number;
  blockCss: CSSProperties;
  startClientX: number;
  startClientY: number;
  /** Fixed-position ghost (viewport px) — follows pointer across day columns. */
  ghostTop: number;
  ghostLeft: number;
  ghostWidth: number;
};

type GoogleEvDragState = {
  ev: GoogleEventDTO;
  offsetY: number;
  pointerId: number;
  durationMins: number;
  blockHeight: number;
  startClientX: number;
  startClientY: number;
  ghostTop: number;
  ghostLeft: number;
  ghostWidth: number;
};

type GoogleEventPalette = {
  bg: string;
  border: string;
  text: string;
  buttonBg: string;
  buttonHover: string;
  buttonText: string;
};

const DEFAULT_GOOGLE_EVENT_PALETTE: GoogleEventPalette = {
  bg: "rgba(230, 244, 234, 0.98)",
  border: "#ceead6",
  text: "#137333",
  buttonBg: "#137333",
  buttonHover: "#0d652b",
  buttonText: "#ffffff",
};

const GOOGLE_EVENT_PALETTE_BY_ID: Record<string, GoogleEventPalette> = {
  "1": { bg: "#e8eefc", border: "#c6d3f8", text: "#334ea3", buttonBg: "#334ea3", buttonHover: "#263b7d", buttonText: "#ffffff" },
  "2": { bg: "#e6f4ea", border: "#ceead6", text: "#137333", buttonBg: "#137333", buttonHover: "#0d652b", buttonText: "#ffffff" },
  "3": { bg: "#f3e8fd", border: "#e2c9fb", text: "#6a1b9a", buttonBg: "#7e57c2", buttonHover: "#5e35b1", buttonText: "#ffffff" },
  "4": { bg: "#fce8e6", border: "#f6c7c3", text: "#a50e0e", buttonBg: "#d93025", buttonHover: "#b3261e", buttonText: "#ffffff" },
  "5": { bg: "#fef7e0", border: "#f9de97", text: "#7a4e00", buttonBg: "#f9ab00", buttonHover: "#f29900", buttonText: "#202124" },
  "6": { bg: "#fff1e6", border: "#ffd0ad", text: "#8d4b00", buttonBg: "#f2994a", buttonHover: "#e5832e", buttonText: "#202124" },
  "7": { bg: "#e0f7fa", border: "#b5e9ef", text: "#0b7285", buttonBg: "#0b7285", buttonHover: "#085c6a", buttonText: "#ffffff" },
  "8": { bg: "#f1f3f4", border: "#dadce0", text: "#3c4043", buttonBg: "#5f6368", buttonHover: "#3c4043", buttonText: "#ffffff" },
  "9": { bg: "#e8f0fe", border: "#c6dafc", text: "#174ea6", buttonBg: "#1a73e8", buttonHover: "#1765cc", buttonText: "#ffffff" },
  "10": { bg: "#e6f4ea", border: "#b7dfba", text: "#0b8043", buttonBg: "#0b8043", buttonHover: "#066837", buttonText: "#ffffff" },
  "11": { bg: "#fce8e6", border: "#f4b7b0", text: "#c5221f", buttonBg: "#c5221f", buttonHover: "#a50e0e", buttonText: "#ffffff" },
};

function googleEventPalette(colorId: string | null | undefined): GoogleEventPalette {
  const key = String(colorId ?? "").trim();
  if (!key) return DEFAULT_GOOGLE_EVENT_PALETTE;
  return GOOGLE_EVENT_PALETTE_BY_ID[key] ?? DEFAULT_GOOGLE_EVENT_PALETTE;
}

function googleEventBlockStyle(colorId: string | null | undefined): CSSProperties {
  const palette = googleEventPalette(colorId);
  return {
    backgroundColor: palette.bg,
    borderColor: palette.border,
  };
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function toDatetimeLocalInput(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDepositLabel(raw: string | null | undefined): string | null {
  const t = raw?.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? `$${t}` : t;
}

function CrmQuickTimeAdjust({
  apt,
  onOptimisticApply,
  onOptimisticRevert,
  onSaved,
  onSaveBanner,
}: {
  apt: BookingsCalendarAppointment;
  onOptimisticApply: (startIso: string, endIso: string) => void;
  onOptimisticRevert: () => void;
  onSaved: () => void;
  onSaveBanner?: (update: Exclude<CalendarSaveBanner, { kind: "hidden" }>) => void;
}) {
  const [startLocal, setStartLocal] = useState(() => toDatetimeLocalInput(new Date(apt.startAt)));
  const [endLocal, setEndLocal] = useState(() => toDatetimeLocalInput(new Date(apt.endAt)));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setStartLocal(toDatetimeLocalInput(new Date(apt.startAt)));
    setEndLocal(toDatetimeLocalInput(new Date(apt.endAt)));
  }, [apt.id, apt.startAt, apt.endAt]);

  const save = () => {
    setErr(null);
    const s = new Date(startLocal);
    const e = new Date(endLocal);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      setErr("Invalid date or time.");
      return;
    }
    if (e.getTime() <= s.getTime()) {
      setErr("End must be after start.");
      return;
    }
    const startIso = s.toISOString();
    const endIso = e.toISOString();
    onOptimisticApply(startIso, endIso);
    setSaving(true);
    onSaveBanner?.({ kind: "saving", message: "Saving times…" });
    window.setTimeout(() => {
      void (async () => {
        try {
          const fd = new FormData();
          fd.set("appointmentId", apt.id);
          fd.set("startAt", startIso);
          fd.set("endAt", endIso);
          await quickUpdateAppointmentTimesAction(fd);
          setSaving(false);
          onSaveBanner?.({ kind: "success", message: "Booking times saved." });
          onSaved();
        } catch (e2) {
          onOptimisticRevert();
          setSaving(false);
          const msg = e2 instanceof Error ? e2.message : "Could not save times.";
          setErr(msg);
          onSaveBanner?.({ kind: "error", message: msg });
        }
      })();
    }, 0);
  };

  const inputCls =
    "mt-0.5 w-full rounded border border-[#dadce0] px-2 py-1.5 text-xs text-[#3c4043] outline-none focus:border-[#1a73e8]";

  return (
    <div className="mt-3 border-t border-[#e8eaed] pt-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#70757a]">Quick adjust time</p>
      <label className="mt-2 block text-[10px] font-medium text-[#70757a]">
        Starts
        <input
          type="datetime-local"
          value={startLocal}
          onChange={(e) => setStartLocal(e.target.value)}
          className={inputCls}
        />
      </label>
      <label className="mt-2 block text-[10px] font-medium text-[#70757a]">
        Ends
        <input
          type="datetime-local"
          value={endLocal}
          onChange={(e) => setEndLocal(e.target.value)}
          className={inputCls}
        />
      </label>
      {err ? <p className="mt-2 text-xs text-red-700">{err}</p> : null}
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="mt-2 w-full rounded-lg bg-[#1a73e8] px-3 py-2 text-xs font-semibold text-white hover:bg-[#1765cc] disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save times"}
      </button>
      <p className="mt-2 text-[10px] text-[#70757a]">Use full edit for client, type, notes, or all-day.</p>
    </div>
  );
}

function CrmCalendarDeleteBooking({
  aptId,
  aptTitle,
  onDone,
  showSaveBanner,
}: {
  aptId: string;
  aptTitle: string;
  onDone: () => void;
  showSaveBanner: (b: CalendarSaveBanner) => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || pending) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setConfirmOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmOpen, pending]);

  const performRemove = () => {
    setErr(null);
    setPending(true);
    setConfirmOpen(false);
    showSaveBanner({ kind: "saving", message: "Removing booking…" });
    void (async () => {
      try {
        const fd = new FormData();
        fd.set("appointmentId", aptId);
        await deleteAppointmentAction(fd);
        setPending(false);
        showSaveBanner({ kind: "success", message: "This booking has been removed from your schedule." });
        onDone();
      } catch (e) {
        setPending(false);
        const em = e instanceof Error ? e.message : "We couldn't remove this booking. Please try again.";
        setErr(em);
        showSaveBanner({ kind: "error", message: em });
      }
    })();
  };

  const confirmDialog =
    confirmOpen && typeof document !== "undefined"
      ? createPortal(
          <>
            <button
              type="button"
              className="fixed inset-0 z-[400] cursor-default bg-black/45 backdrop-blur-[1px]"
              aria-label="Close dialog"
              onClick={() => {
                if (!pending) setConfirmOpen(false);
              }}
            />
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="crm-remove-booking-title"
              aria-describedby="crm-remove-booking-desc"
              className="fixed top-1/2 left-1/2 z-[410] w-[min(calc(100vw-2rem),22rem)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[#dadce0] bg-white p-5 shadow-2xl"
            >
              <h3 id="crm-remove-booking-title" className="text-base font-semibold text-[#3c4043]">
                Remove this booking?
              </h3>
              <div id="crm-remove-booking-desc" className="mt-3 space-y-2 text-sm leading-relaxed text-[#5f6368]">
                <p>
                  <span className="font-medium text-[#3c4043]">&ldquo;{aptTitle}&rdquo;</span> will disappear from
                  this calendar.
                </p>
                <p>{"If it's linked to Google Calendar, we'll try to remove it there as well."}</p>
              </div>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setConfirmOpen(false)}
                  className="rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-xs font-semibold text-[#3c4043] hover:bg-[#f8f9fa] disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={performRemove}
                  className="rounded-lg bg-rose-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50"
                >
                  Remove from schedule
                </button>
              </div>
            </div>
          </>,
          document.body,
        )
      : null;

  return (
    <div className="mt-3 border-t border-[#e8eaed] pt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmOpen(true)}
        aria-label={`Remove booking: ${aptTitle}`}
        aria-haspopup="dialog"
        aria-expanded={confirmOpen}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-900 shadow-sm hover:border-rose-300 hover:bg-rose-100 disabled:opacity-60"
      >
        <Trash2 className="h-3.5 w-3.5 shrink-0 text-rose-600" aria-hidden />
        {pending ? "Removing…" : "Remove booking"}
      </button>
      {err ? <p className="mt-2 text-xs text-red-700">{err}</p> : null}
      {confirmDialog}
    </div>
  );
}

type MonthDragBind = {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void;
};

type MonthCrmDragState = {
  apt: BookingsCalendarAppointment;
  sourceDay: Date;
  pointerId: number;
  sx: number;
  sy: number;
  ghostTop: number;
  ghostLeft: number;
  ghostWidth: number;
  ghostHeight: number;
  offsetX: number;
  offsetY: number;
  blockCss: CSSProperties;
};

type MonthGoogleDragState = {
  ev: GoogleEventDTO;
  sourceDay: Date;
  pointerId: number;
  sx: number;
  sy: number;
  ghostTop: number;
  ghostLeft: number;
  ghostWidth: number;
  ghostHeight: number;
  offsetX: number;
  offsetY: number;
};

function DayTimeColumn({
  day,
  appointments,
  timedGoogle,
  maxParallelBookings,
  slotUsage,
  canCreate,
  defaultDurationMins,
  canEditAppointments,
  googleReschedulable,
  onSlotRelease,
  onCrmOpen,
  onCrmReschedule,
  onGoogleOpen,
  onGoogleReschedule,
  hours,
}: {
  day: Date;
  appointments: BookingsCalendarAppointment[];
  timedGoogle: GoogleEventDTO[];
  maxParallelBookings: number;
  slotUsage: Record<string, number>;
  canCreate: boolean;
  defaultDurationMins: number;
  canEditAppointments: boolean;
  /** When true, timed Google blocks can be dragged like CRM (including to other days in week view). */
  googleReschedulable: boolean;
  onSlotRelease: (start: Date, durationMins: number) => void;
  onCrmOpen: (a: BookingsCalendarAppointment, clientX: number, clientY: number) => void;
  onCrmReschedule: (a: BookingsCalendarAppointment, newStart: Date) => void;
  onGoogleOpen: (ev: GoogleEventDTO, clientX: number, clientY: number) => void;
  onGoogleReschedule: (ev: GoogleEventDTO, newStart: Date) => void;
  hours: number[];
}) {
  const colRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ startY: number; curY: number; pid: number } | null>(null);
  const [crmDrag, setCrmDrag] = useState<CrmAptDragState | null>(null);
  const crmDragLocal = useRef<CrmAptDragState | null>(null);
  const skipNextCrmDetailClick = useRef(false);
  const [googleDrag, setGoogleDrag] = useState<GoogleEvDragState | null>(null);
  const googleDragLocal = useRef<GoogleEvDragState | null>(null);
  const skipNextGoogleDetailClick = useRef(false);
  const crmLastHitColRef = useRef<HTMLElement | null>(null);
  const googleLastHitColRef = useRef<HTMLElement | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canCreate || e.button !== 0) return;
    const el = colRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const y = Math.max(0, Math.min(GRID_HEIGHT, e.clientY - rect.top));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ startY: y, curY: y, pid: e.pointerId });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pid || !colRef.current) return;
    const rect = colRef.current.getBoundingClientRect();
    const y = Math.max(0, Math.min(GRID_HEIGHT, e.clientY - rect.top));
    setDrag((d) => (d ? { ...d, curY: y } : null));
  };

  const finishPointer = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.pid) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    const dist = Math.abs(drag.curY - drag.startY);
    if (dist < 8) {
      const m = yToClippedDayMinutes(drag.startY);
      onSlotRelease(dayMinutesToDate(day, m), defaultDurationMins);
    } else {
      const y1 = Math.min(drag.startY, drag.curY);
      const y2 = Math.max(drag.startY, drag.curY);
      const m1 = yToClippedDayMinutes(y1);
      const m2 = yToClippedDayMinutes(y2);
      const duration = Math.max(15, m2 - m1);
      onSlotRelease(dayMinutesToDate(day, m1), duration);
    }
    setDrag(null);
  };

  const now = new Date();
  let nowLine: ReactNode = null;
  if (isSameDay(day, now)) {
    const mins = now.getHours() * 60 + now.getMinutes();
    const g0 = HOUR_START * 60;
    const g1 = HOUR_END * 60;
    if (mins >= g0 && mins <= g1) {
      const top = ((mins - g0) / 60) * PX_PER_HOUR;
      nowLine = (
        <div
          className="pointer-events-none absolute right-0 left-0 z-[25] border-t-2 border-[#ea4335]"
          style={{ top }}
        >
          <span className="absolute -top-1.5 left-0 h-2 w-2 rounded-full bg-[#ea4335]" />
        </div>
      );
    }
  }

  const dayColKey = format(day, "yyyy-MM-dd");

  return (
    <div
      ref={colRef}
      data-calendar-col={dayColKey}
      className="relative border-r border-[#dadce0] bg-white last:border-r-0"
      style={{ height: GRID_HEIGHT }}
    >
      {hours.map((h) => (
        <div key={h} className="border-b border-[#dadce0]/70" style={{ height: PX_PER_HOUR }} />
      ))}

      {canCreate ? (
        <div
          className="absolute inset-0 z-[1] cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={finishPointer}
          onPointerCancel={() => setDrag(null)}
        />
      ) : null}

      {drag ? (
        <div
          className="pointer-events-none absolute right-1 left-1 z-[5] rounded border border-[#1a73e8]/50 bg-[#1a73e8]/15"
          style={{
            top: Math.min(drag.startY, drag.curY),
            height: Math.max(10, Math.abs(drag.curY - drag.startY)),
          }}
        />
      ) : null}

      {nowLine}

      {appointments.map((a) => {
        const start = new Date(a.startAt);
        const end = new Date(a.endAt);
        const layout = layoutTimedBlock(day, start, end);
        if (!layout) return null;
        const slotKey = a.capacitySlot || start.toISOString();
        const load = slotUsage[slotKey] ?? 1;
        const blockStyle = bookingCalendarBlockStyle(a.typeColorHex);
        const durationMins = Math.max(15, differenceInMinutes(end, start));
        const draggingThis = crmDrag?.apt.id === a.id;
        return (
          <button
            key={`${a.id}-${day.toISOString()}`}
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              if (!canEditAppointments || e.button !== 0) return;
              const el = colRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const offsetY = e.clientY - rect.top - layout.top;
              const colRoot = colRef.current;
              crmLastHitColRef.current = colRoot;
              const gr = colRoot
                ? ghostFixedRect(colRoot, e.clientY, offsetY, layout.height)
                : { top: e.clientY - offsetY, left: e.clientX - 60, width: 120 };
              const initial: CrmAptDragState = {
                apt: a,
                offsetY,
                pointerId: e.pointerId,
                durationMins,
                blockHeight: layout.height,
                blockCss: blockStyle,
                startClientX: e.clientX,
                startClientY: e.clientY,
                ghostTop: gr.top,
                ghostLeft: gr.left,
                ghostWidth: gr.width,
              };
              crmDragLocal.current = initial;
              setCrmDrag(initial);
              (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              if (!canEditAppointments) return;
              const m = crmDragLocal.current;
              if (!m || e.pointerId !== m.pointerId) return;
              const hit = calendarColumnElFromPoint(e.clientX, e.clientY);
              if (hit) crmLastHitColRef.current = hit;
              const colEl = hit ?? crmLastHitColRef.current ?? colRef.current;
              if (!colEl) return;
              const gr = ghostFixedRect(colEl, e.clientY, m.offsetY, m.blockHeight);
              const next = { ...m, ghostTop: gr.top, ghostLeft: gr.left, ghostWidth: gr.width };
              crmDragLocal.current = next;
              setCrmDrag(next);
            }}
            onPointerUp={(e) => {
              if (!canEditAppointments) return;
              const m = crmDragLocal.current;
              if (!m || e.pointerId !== m.pointerId) return;
              try {
                (e.currentTarget as HTMLButtonElement).releasePointerCapture(e.pointerId);
              } catch {
                /* ignore */
              }
              const moved =
                Math.hypot(e.clientX - m.startClientX, e.clientY - m.startClientY) >= 6;
              if (!moved) {
                crmDragLocal.current = null;
                crmLastHitColRef.current = null;
                setCrmDrag(null);
                skipNextCrmDetailClick.current = true;
                onCrmOpen(m.apt, e.clientX, e.clientY);
                return;
              }
              skipNextCrmDetailClick.current = true;
              const colEl =
                calendarColumnElFromPoint(e.clientX, e.clientY) ?? crmLastHitColRef.current ?? colRef.current;
              crmDragLocal.current = null;
              crmLastHitColRef.current = null;
              setCrmDrag(null);
              if (!colEl) return;
              const newStart = newStartFromPointerInColumn(
                colEl,
                e.clientY,
                m.offsetY,
                m.blockHeight,
                m.durationMins,
              );
              if (!newStart) return;
              onCrmReschedule(m.apt, newStart);
            }}
            onPointerCancel={() => {
              crmDragLocal.current = null;
              crmLastHitColRef.current = null;
              setCrmDrag(null);
            }}
            onClick={(e) => {
              if (skipNextCrmDetailClick.current) {
                skipNextCrmDetailClick.current = false;
                e.stopPropagation();
                return;
              }
              e.stopPropagation();
              onCrmOpen(a, e.clientX, e.clientY);
            }}
            className={cn(
              "absolute left-0.5 right-0.5 overflow-hidden rounded px-1 py-0.5 text-left shadow-sm ring-1 ring-black/[0.06] transition hover:z-20 hover:brightness-[0.98]",
              canEditAppointments && "cursor-grab touch-none active:cursor-grabbing",
            )}
            style={{
              ...blockStyle,
              top: layout.top,
              height: layout.height,
              zIndex: draggingThis ? 8 : 10,
              opacity: draggingThis ? 0 : 1,
              pointerEvents: draggingThis ? "none" : undefined,
            }}
            title={
              (canEditAppointments
                ? `${a.title} · ${a.clientName} — drag to reschedule`
                : `${a.title} · ${a.clientName}`) + crmGoogleSyncTitleSuffix(a.googleSyncStatus)
            }
          >
            <p className="truncate text-[11px] font-semibold leading-tight" style={{ color: a.typeColorHex }}>
              {a.title}
            </p>
            <p className="truncate text-[10px] text-[#3c4043]">{a.clientName}</p>
            <p className="truncate text-[9px] text-[#70757a]">
              {format(start, "h:mm a")} · {a.resourceKey} · slot {load}/{maxParallelBookings}
            </p>
          </button>
        );
      })}

      {crmDrag ? (
        <div
          className="pointer-events-none fixed z-[40] overflow-hidden rounded px-1 py-0.5 shadow-lg ring-2 ring-[#1a73e8]"
          style={{
            ...crmDrag.blockCss,
            top: crmDrag.ghostTop,
            left: crmDrag.ghostLeft,
            width: crmDrag.ghostWidth,
            height: crmDrag.blockHeight,
          }}
          aria-hidden
        >
          <p className="truncate text-[11px] font-semibold leading-tight" style={{ color: crmDrag.apt.typeColorHex }}>
            {crmDrag.apt.title}
          </p>
          <p className="truncate text-[10px] text-[#3c4043]">{crmDrag.apt.clientName}</p>
          <p className="truncate text-[9px] font-medium text-[#1967d2]">Moving…</p>
        </div>
      ) : null}

      {timedGoogle.map((e) => {
        const start = new Date(e.start);
        const end = new Date(e.end);
        const layout = layoutTimedBlock(day, start, end);
        if (!layout) return null;
        const palette = googleEventPalette(e.colorId);
        const blockStyle = googleEventBlockStyle(e.colorId);
        const durationMins = Math.max(15, differenceInMinutes(end, start));
        const draggingGoogle = googleDrag?.ev.id === e.id;
        return (
          <button
            key={`${e.id}-${day.toISOString()}`}
            type="button"
            onPointerDown={(ev) => {
              ev.stopPropagation();
              if (!googleReschedulable || ev.button !== 0) return;
              const el = colRef.current;
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const offsetY = ev.clientY - rect.top - layout.top;
              const colRoot = colRef.current;
              googleLastHitColRef.current = colRoot;
              const gr = colRoot
                ? ghostFixedRect(colRoot, ev.clientY, offsetY, layout.height)
                : { top: ev.clientY - offsetY, left: ev.clientX - 60, width: 120 };
              const initial: GoogleEvDragState = {
                ev: e,
                offsetY,
                pointerId: ev.pointerId,
                durationMins,
                blockHeight: layout.height,
                startClientX: ev.clientX,
                startClientY: ev.clientY,
                ghostTop: gr.top,
                ghostLeft: gr.left,
                ghostWidth: gr.width,
              };
              googleDragLocal.current = initial;
              setGoogleDrag(initial);
              (ev.currentTarget as HTMLButtonElement).setPointerCapture(ev.pointerId);
            }}
            onPointerMove={(ev) => {
              if (!googleReschedulable) return;
              const m = googleDragLocal.current;
              if (!m || ev.pointerId !== m.pointerId) return;
              const hit = calendarColumnElFromPoint(ev.clientX, ev.clientY);
              if (hit) googleLastHitColRef.current = hit;
              const colEl = hit ?? googleLastHitColRef.current ?? colRef.current;
              if (!colEl) return;
              const gr = ghostFixedRect(colEl, ev.clientY, m.offsetY, m.blockHeight);
              const next = { ...m, ghostTop: gr.top, ghostLeft: gr.left, ghostWidth: gr.width };
              googleDragLocal.current = next;
              setGoogleDrag(next);
            }}
            onPointerUp={(ev) => {
              if (!googleReschedulable) return;
              const m = googleDragLocal.current;
              if (!m || ev.pointerId !== m.pointerId) return;
              try {
                (ev.currentTarget as HTMLButtonElement).releasePointerCapture(ev.pointerId);
              } catch {
                /* ignore */
              }
              const moved =
                Math.hypot(ev.clientX - m.startClientX, ev.clientY - m.startClientY) >= 6;
              if (!moved) {
                googleDragLocal.current = null;
                googleLastHitColRef.current = null;
                setGoogleDrag(null);
                skipNextGoogleDetailClick.current = true;
                onGoogleOpen(m.ev, ev.clientX, ev.clientY);
                return;
              }
              skipNextGoogleDetailClick.current = true;
              const colEl =
                calendarColumnElFromPoint(ev.clientX, ev.clientY) ??
                googleLastHitColRef.current ??
                colRef.current;
              googleDragLocal.current = null;
              googleLastHitColRef.current = null;
              setGoogleDrag(null);
              if (!colEl) return;
              const newStart = newStartFromPointerInColumn(
                colEl,
                ev.clientY,
                m.offsetY,
                m.blockHeight,
                m.durationMins,
              );
              if (!newStart) return;
              onGoogleReschedule(m.ev, newStart);
            }}
            onPointerCancel={() => {
              googleDragLocal.current = null;
              googleLastHitColRef.current = null;
              setGoogleDrag(null);
            }}
            onClick={(ev) => {
              if (skipNextGoogleDetailClick.current) {
                skipNextGoogleDetailClick.current = false;
                ev.stopPropagation();
                return;
              }
              ev.stopPropagation();
              onGoogleOpen(e, ev.clientX, ev.clientY);
            }}
            className={cn(
              "absolute left-0.5 right-0.5 overflow-hidden rounded border px-1 py-0.5 text-left shadow-sm hover:z-20",
              googleReschedulable && "cursor-grab touch-none active:cursor-grabbing",
            )}
            style={{
              ...blockStyle,
              top: layout.top,
              height: layout.height,
              zIndex: draggingGoogle ? 8 : 9,
              opacity: draggingGoogle ? 0 : 1,
              pointerEvents: draggingGoogle ? "none" : undefined,
            }}
            title={
              googleReschedulable
                ? `${e.summary} — drag to reschedule (Google)`
                : e.summary
            }
          >
            <p className="truncate text-[11px] font-semibold leading-tight" style={{ color: palette.text }}>
              {e.summary}
            </p>
            <p className="truncate text-[9px]" style={{ color: palette.text, opacity: 0.85 }}>
              Google Calendar
            </p>
          </button>
        );
      })}

      {googleDrag ? (
        <div
          className="pointer-events-none fixed z-[40] overflow-hidden rounded border-2 border-[#1a73e8] px-1 py-0.5 shadow-lg"
          style={{
            ...googleEventBlockStyle(googleDrag.ev.colorId),
            top: googleDrag.ghostTop,
            left: googleDrag.ghostLeft,
            width: googleDrag.ghostWidth,
            height: googleDrag.blockHeight,
          }}
          aria-hidden
        >
          <p
            className="truncate text-[11px] font-semibold leading-tight"
            style={{ color: googleEventPalette(googleDrag.ev.colorId).text }}
          >
            {googleDrag.ev.summary}
          </p>
          <p className="truncate text-[10px] text-[#3c4043]">Google Calendar</p>
          <p className="truncate text-[9px] font-medium text-[#1967d2]">Moving…</p>
        </div>
      ) : null}
    </div>
  );
}

function MonthCell({
  day,
  focusMonth,
  appointments,
  googleTimed,
  googleAllDay,
  maxParallelBookings,
  slotUsage,
  onOpenDay,
  bindMonthCrm,
  bindMonthGoogleTimed,
  monthCrmDraggingId,
  monthGoogleDraggingId,
}: {
  day: Date;
  focusMonth: Date;
  appointments: BookingsCalendarAppointment[];
  googleTimed: GoogleEventDTO[];
  googleAllDay: GoogleEventDTO[];
  maxParallelBookings: number;
  slotUsage: Record<string, number>;
  onOpenDay: (d: Date) => void;
  bindMonthCrm?: (apt: BookingsCalendarAppointment, cellDay: Date) => MonthDragBind;
  bindMonthGoogleTimed?: (ev: GoogleEventDTO, cellDay: Date) => MonthDragBind;
  monthCrmDraggingId?: string | null;
  monthGoogleDraggingId?: string | null;
}) {
  const inMonth = isSameMonth(day, focusMonth);
  const isToday = isSameDay(day, new Date());
  const dayKey = format(day, "yyyy-MM-dd");

  const crm = appointments.filter((a) =>
    overlapsDay(new Date(a.startAt), new Date(a.endAt), day),
  );
  const gTimed = googleTimed.filter((e) =>
    overlapsDay(new Date(e.start), new Date(e.end), day),
  );
  const gAll = googleAllDay.filter((e) => overlapsDay(new Date(e.start), new Date(e.end), day));

  const lines: { key: string; el: ReactNode }[] = [];
  for (const a of crm.slice(0, 4)) {
    const start = new Date(a.startAt);
    const slotKey = a.capacitySlot || start.toISOString();
    const load = slotUsage[slotKey] ?? 1;
    const monthBlockStyle = bookingCalendarBlockStyle(a.typeColorHex);
    const drag = bindMonthCrm?.(a, day);
    const crmDraggingThis = monthCrmDraggingId === a.id;
    lines.push({
      key: `c-${a.id}`,
      el: drag ? (
        <button
          type="button"
          title={`${a.title} · ${a.clientName} — drag to another day (time unchanged); click for quick edit${crmGoogleSyncTitleSuffix(a.googleSyncStatus)}`}
          className="block w-full cursor-grab truncate rounded-sm px-1 py-0.5 text-left text-[10px] font-medium leading-tight ring-1 ring-black/[0.06] hover:brightness-[0.97] active:cursor-grabbing touch-none"
          style={{
            ...monthBlockStyle,
            opacity: crmDraggingThis ? 0 : 1,
            pointerEvents: crmDraggingThis ? "none" : undefined,
          }}
          {...drag}
        >
          <span style={{ color: a.typeColorHex }}>{format(start, "h:mm a")} {a.title}</span>
          <span className="font-normal text-[#5f6368]">
            {" "}
            ({load}/{maxParallelBookings})
          </span>
        </button>
      ) : (
        <a
          href={`/clients/${a.clientId}`}
          className="block truncate rounded-sm px-1 py-0.5 text-[10px] font-medium leading-tight ring-1 ring-black/[0.06] hover:brightness-[0.97]"
          style={monthBlockStyle}
          title={`${a.title} · ${a.clientName}${crmGoogleSyncTitleSuffix(a.googleSyncStatus)}`}
        >
          <span style={{ color: a.typeColorHex }}>{format(start, "h:mm a")} {a.title}</span>
          <span className="font-normal text-[#5f6368]">
            {" "}
            ({load}/{maxParallelBookings})
          </span>
        </a>
      ),
    });
  }
  for (const e of gAll.slice(0, 2)) {
    const palette = googleEventPalette(e.colorId);
    lines.push({
      key: `ga-${e.id}`,
      el: (
        <a
          href={e.htmlLink || "#"}
          target="_blank"
          rel="noreferrer"
          className="block truncate rounded-sm border px-1 py-0.5 text-[10px] font-medium"
          style={{ borderColor: palette.border, backgroundColor: palette.bg, color: palette.text }}
        >
          {e.summary}
        </a>
      ),
    });
  }
  for (const e of gTimed.slice(0, 3)) {
    const palette = googleEventPalette(e.colorId);
    const gDrag = bindMonthGoogleTimed?.(e, day);
    const gDraggingThis = monthGoogleDraggingId === e.id;
    lines.push({
      key: `gt-${e.id}`,
      el: gDrag ? (
        <button
          type="button"
          title={`${e.summary} — drag to another day (time unchanged); click for details`}
          className="block w-full cursor-grab truncate rounded-sm border px-1 py-0.5 text-left text-[10px] font-medium active:cursor-grabbing touch-none"
          style={{
            borderColor: palette.border,
            backgroundColor: palette.bg,
            color: palette.text,
            opacity: gDraggingThis ? 0 : 1,
            pointerEvents: gDraggingThis ? "none" : undefined,
          }}
          {...gDrag}
        >
          {format(new Date(e.start), "h:mm a")} {e.summary}
        </button>
      ) : e.htmlLink ? (
        <a
          href={e.htmlLink}
          target="_blank"
          rel="noreferrer"
          className="block truncate rounded-sm border px-1 py-0.5 text-[10px] font-medium"
          style={{ borderColor: palette.border, backgroundColor: palette.bg, color: palette.text }}
        >
          {format(new Date(e.start), "h:mm a")} {e.summary}
        </a>
      ) : (
        <span
          className="block truncate rounded-sm border px-1 py-0.5 text-[10px] font-medium"
          style={{ borderColor: palette.border, backgroundColor: palette.bg, color: palette.text }}
        >
          {format(new Date(e.start), "h:mm a")} {e.summary}
        </span>
      ),
    });
  }
  const extra = crm.length + gTimed.length + gAll.length - lines.length;
  const more = extra > 0 ? <p className="text-[10px] font-medium text-[#70757a]">+{extra} more</p> : null;

  return (
    <div
      data-month-day={dayKey}
      className={cn(
        "min-h-[100px] border-r border-b border-[#dadce0] p-1 last:border-r-0",
        !inMonth && "bg-[#f8f9fa]",
        isToday && "bg-[#e8f0fe]/50",
      )}
    >
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={() => onOpenDay(day)}
          title="Open day view"
          className={cn(
            "tabular-nums text-sm",
            isToday &&
              "flex h-7 w-7 items-center justify-center rounded-full bg-[#1a73e8] text-sm font-medium text-white",
            !isToday && !inMonth && "text-[#70757a]",
            !isToday && inMonth && "text-[#3c4043]",
          )}
        >
          {format(day, "d")}
        </button>
      </div>
      <div className="flex flex-col gap-0.5">{lines.map((l) => <div key={l.key}>{l.el}</div>)}</div>
      {more}
    </div>
  );
}

type Props = {
  appointments: BookingsCalendarAppointment[];
  /** Active booking types for the create dialog (code + label). */
  bookingTypeFormOptions: { code: string; label: string }[];
  slotUsage: Record<string, number>;
  maxParallelBookings: number;
  googleConnected: boolean;
  defaultDurationMins: number;
  canCreate: boolean;
  canEditAppointments: boolean;
  formClients: AppointmentFormClientOption[];
  productServiceOptionsForBooking?: {
    code: string;
    label: string;
    matchTerms: string;
    active: boolean;
  }[] | null;
};

type DetailPop =
  | { kind: "crm"; apt: BookingsCalendarAppointment; x: number; y: number }
  | { kind: "google"; ev: GoogleEventDTO; x: number; y: number };

export function BookingsCalendar({
  appointments,
  bookingTypeFormOptions,
  slotUsage,
  maxParallelBookings,
  googleConnected,
  defaultDurationMins,
  canCreate,
  canEditAppointments,
  formClients,
  productServiceOptionsForBooking = [],
}: Props) {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("week");
  const [cursor, setCursor] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }));

  const [googleEvents, setGoogleEvents] = useState<GoogleEventDTO[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [saveBanner, setSaveBanner] = useState<CalendarSaveBanner>({ kind: "hidden" });
  const saveBannerHideTimerRef = useRef<number | null>(null);
  const [crmTimeOverrides, setCrmTimeOverrides] = useState<Map<string, { startAt: string; endAt: string }>>(
    () => new Map(),
  );
  const [googleTimeOverrides, setGoogleTimeOverrides] = useState<Map<string, { start: string; end: string }>>(
    () => new Map(),
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [createStart, setCreateStart] = useState(() => new Date());
  const [createDuration, setCreateDuration] = useState(defaultDurationMins);
  const [prefillFromCall, setPrefillFromCall] = useState<BookingFromCallPayload | null>(null);
  const [detail, setDetail] = useState<DetailPop | null>(null);

  const slotTapRef = useRef<{
    timeout: ReturnType<typeof setTimeout> | null;
    pendingKey: string | null;
  }>({ timeout: null, pendingKey: null });

  useEffect(() => {
    return () => {
      if (slotTapRef.current.timeout) clearTimeout(slotTapRef.current.timeout);
    };
  }, []);

  const showSaveBanner = useCallback((next: CalendarSaveBanner) => {
    if (saveBannerHideTimerRef.current) {
      clearTimeout(saveBannerHideTimerRef.current);
      saveBannerHideTimerRef.current = null;
    }
    setSaveBanner(next);
    if (next.kind === "success" || next.kind === "error") {
      const ms = next.kind === "success" ? 5200 : 16000;
      saveBannerHideTimerRef.current = window.setTimeout(() => {
        setSaveBanner({ kind: "hidden" });
        saveBannerHideTimerRef.current = null;
      }, ms);
    }
  }, []);

  const dismissSaveBanner = useCallback(() => {
    if (saveBannerHideTimerRef.current) {
      clearTimeout(saveBannerHideTimerRef.current);
      saveBannerHideTimerRef.current = null;
    }
    setSaveBanner({ kind: "hidden" });
  }, []);

  useEffect(
    () => () => {
      if (saveBannerHideTimerRef.current) clearTimeout(saveBannerHideTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const p = peekBookingFromCall();
    if (!p?.clientId?.trim()) return;
    if (!canCreate) return;
    try {
      sessionStorage.removeItem(BOOKING_FROM_CALL_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setPrefillFromCall(p);
    setCreateStart(defaultNextBookingStart());
    setCreateDuration(defaultDurationMins);
    setCreateOpen(true);
  }, [canCreate, defaultDurationMins]);

  const goToDay = useCallback((d: Date) => {
    setView("day");
    setCursor(startOfDay(d));
  }, []);

  const handleSlotRelease = useCallback(
    (start: Date, durationMins: number) => {
      if (!canCreate) return;
      const key = `${start.toISOString().slice(0, 16)}-${durationMins}`;
      const R = slotTapRef.current;
      if (R.timeout && R.pendingKey === key) {
        clearTimeout(R.timeout);
        R.timeout = null;
        R.pendingKey = null;
        const end = addMinutes(start, durationMins);
        router.push(
          `/appointments/new?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
        );
        return;
      }
      if (R.timeout) {
        clearTimeout(R.timeout);
        R.timeout = null;
      }
      R.pendingKey = key;
      R.timeout = setTimeout(() => {
        R.timeout = null;
        R.pendingKey = null;
        setCreateStart(start);
        setCreateDuration(durationMins);
        setCreateOpen(true);
      }, 280);
    },
    [canCreate, router],
  );

  const openFullEditorFromDialog = useCallback(() => {
    const end = addMinutes(createStart, createDuration);
    setCreateOpen(false);
    router.push(
      `/appointments/new?start=${encodeURIComponent(createStart.toISOString())}&end=${encodeURIComponent(end.toISOString())}`,
    );
  }, [createStart, createDuration, router]);

  const changeView = useCallback((v: ViewMode) => {
    setView(v);
    setCursor((c) => {
      if (v === "day") return startOfDay(c);
      if (v === "week") return startOfWeek(c, { weekStartsOn: 0 });
      return startOfMonth(c);
    });
  }, []);

  const goToday = useCallback(() => {
    const n = new Date();
    if (view === "day") setCursor(startOfDay(n));
    else if (view === "week") setCursor(startOfWeek(n, { weekStartsOn: 0 }));
    else setCursor(startOfMonth(n));
  }, [view]);

  const goPrev = useCallback(() => {
    setCursor((c) => {
      if (view === "day") return addDays(startOfDay(c), -1);
      if (view === "week") return addWeeks(startOfWeek(c, { weekStartsOn: 0 }), -1);
      return addMonths(startOfMonth(c), -1);
    });
  }, [view]);

  const goNext = useCallback(() => {
    setCursor((c) => {
      if (view === "day") return addDays(startOfDay(c), 1);
      if (view === "week") return addWeeks(startOfWeek(c, { weekStartsOn: 0 }), 1);
      return addMonths(startOfMonth(c), 1);
    });
  }, [view]);

  const { rangeFrom, rangeTo, titlePrimary, titleSecondary } = useMemo(() => {
    if (view === "day") {
      const d = startOfDay(cursor);
      return {
        rangeFrom: d,
        rangeTo: endOfDay(d),
        titlePrimary: format(d, "EEEE"),
        titleSecondary: format(d, "MMMM d, yyyy"),
      };
    }
    if (view === "week") {
      const ws = startOfWeek(cursor, { weekStartsOn: 0 });
      const we = endOfWeek(ws, { weekStartsOn: 0 });
      return {
        rangeFrom: startOfDay(ws),
        rangeTo: endOfDay(we),
        titlePrimary: format(ws, "MMMM yyyy"),
        titleSecondary: `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`,
      };
    }
    const ms = startOfMonth(cursor);
    const me = endOfMonth(cursor);
    const gridStart = startOfWeek(ms, { weekStartsOn: 0 });
    const gridEnd = addDays(gridStart, 41);
    return {
      rangeFrom: startOfDay(gridStart),
      rangeTo: endOfDay(gridEnd),
      titlePrimary: format(ms, "MMMM yyyy"),
      titleSecondary: format(ms, "yyyy"),
    };
  }, [view, cursor]);

  const headerDays = useMemo(() => {
    if (view === "day") return [startOfDay(cursor)];
    if (view === "week") {
      const ws = startOfWeek(cursor, { weekStartsOn: 0 });
      return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
    }
    return [];
  }, [view, cursor]);

  const monthGrid = useMemo(() => {
    if (view !== "month") return [];
    const ms = startOfMonth(cursor);
    const gridStart = startOfWeek(ms, { weekStartsOn: 0 });
    return Array.from({ length: 6 }, (_, w) =>
      Array.from({ length: 7 }, (_, d) => addDays(gridStart, w * 7 + d)),
    );
  }, [view, cursor]);

  const excludeIds = useMemo(
    () =>
      appointments
        .map((a) => a.googleEventId)
        .filter((id): id is string => Boolean(id && id.trim())),
    [appointments],
  );

  const fetchGoogle = useCallback(async () => {
    if (!googleConnected) {
      setGoogleEvents([]);
      return;
    }
    setGoogleLoading(true);
    setGoogleError(null);
    const params = new URLSearchParams({
      from: rangeFrom.toISOString(),
      to: rangeTo.toISOString(),
    });
    if (excludeIds.length) {
      params.set("excludeIds", excludeIds.join(","));
    }
    try {
      const res = await fetch(`/api/calendar/google-events?${params.toString()}`);
      const data = await res.json();
      if (!res.ok && data && typeof data.error === "string") {
        setGoogleEvents([]);
        setGoogleError(data.error);
        return;
      }
      if (Array.isArray(data)) {
        setGoogleEvents(data as GoogleEventDTO[]);
      } else {
        setGoogleEvents([]);
      }
    } catch {
      setGoogleError("Could not reach Google Calendar.");
      setGoogleEvents([]);
    } finally {
      setGoogleLoading(false);
    }
  }, [googleConnected, rangeFrom, rangeTo, excludeIds]);

  useEffect(() => {
    void fetchGoogle();
  }, [fetchGoogle]);

  const handleCrmReschedule = useCallback(
    (apt: BookingsCalendarAppointment, newStart: Date) => {
      const durMins = Math.max(15, differenceInMinutes(new Date(apt.endAt), new Date(apt.startAt)));
      const newEnd = addMinutes(newStart, durMins);
      showSaveBanner({ kind: "saving", message: "Saving new booking time…" });
      setCrmTimeOverrides((prev) => {
        const next = new Map(prev);
        next.set(apt.id, { startAt: newStart.toISOString(), endAt: newEnd.toISOString() });
        return next;
      });
      void (async () => {
        try {
          const fd = new FormData();
          fd.set("appointmentId", apt.id);
          fd.set("startAt", newStart.toISOString());
          await rescheduleAppointmentAction(fd);
          await router.refresh();
          showSaveBanner({ kind: "success", message: `“${apt.title}” moved — saved successfully.` });
        } catch (err) {
          setCrmTimeOverrides((prev) => {
            const next = new Map(prev);
            next.delete(apt.id);
            return next;
          });
          const msg =
            err instanceof Error ? err.message : "Could not move the booking (network or server error).";
          showSaveBanner({ kind: "error", message: msg });
        }
      })();
    },
    [router, showSaveBanner],
  );

  const handleGoogleReschedule = useCallback(
    (ev: GoogleEventDTO, newStart: Date) => {
      if (ev.allDay) return;
      const durMins = Math.max(15, differenceInMinutes(new Date(ev.end), new Date(ev.start)));
      const newEnd = addMinutes(newStart, durMins);
      showSaveBanner({ kind: "saving", message: "Saving Google Calendar event…" });
      setGoogleTimeOverrides((prev) => {
        const next = new Map(prev);
        next.set(ev.id, { start: newStart.toISOString(), end: newEnd.toISOString() });
        return next;
      });
      void (async () => {
        try {
          const fd = new FormData();
          fd.set("eventId", ev.id);
          fd.set("startAt", newStart.toISOString());
          fd.set("endAt", newEnd.toISOString());
          await rescheduleGoogleCalendarEventAction(fd);
          await fetchGoogle();
          await router.refresh();
          showSaveBanner({ kind: "success", message: `“${ev.summary}” updated in Google Calendar.` });
        } catch (err) {
          setGoogleTimeOverrides((prev) => {
            const next = new Map(prev);
            next.delete(ev.id);
            return next;
          });
          const msg =
            err instanceof Error ? err.message : "Could not move the Google event (network or server error).";
          showSaveBanner({ kind: "error", message: msg });
        }
      })();
    },
    [router, fetchGoogle, showSaveBanner],
  );

  const [monthCrmDrag, setMonthCrmDrag] = useState<MonthCrmDragState | null>(null);
  const [monthGoogleDrag, setMonthGoogleDrag] = useState<MonthGoogleDragState | null>(null);
  const monthCrmDragRef = useRef<MonthCrmDragState | null>(null);
  const monthGoogleDragRef = useRef<MonthGoogleDragState | null>(null);
  const skipNextMonthCrmClick = useRef(false);
  const skipNextMonthGoogleClick = useRef(false);

  const bindMonthCrm = useCallback(
    (apt: BookingsCalendarAppointment, cellDay: Date): MonthDragBind => ({
      onPointerDown(e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        const btn = e.currentTarget;
        const rect = btn.getBoundingClientRect();
        const ghostWidth = Math.max(rect.width, 100);
        const ghostHeight = Math.max(rect.height, 30);
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        const next: MonthCrmDragState = {
          apt,
          sourceDay: startOfDay(cellDay),
          pointerId: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          ghostTop: rect.top,
          ghostLeft: rect.left,
          ghostWidth,
          ghostHeight,
          offsetX,
          offsetY,
          blockCss: bookingCalendarBlockStyle(apt.typeColorHex),
        };
        monthCrmDragRef.current = next;
        setMonthCrmDrag(next);
        btn.setPointerCapture(e.pointerId);
      },
      onPointerMove(e) {
        const m = monthCrmDragRef.current;
        if (!m || e.pointerId !== m.pointerId) return;
        const next: MonthCrmDragState = {
          ...m,
          ghostTop: e.clientY - m.offsetY,
          ghostLeft: e.clientX - m.offsetX,
        };
        monthCrmDragRef.current = next;
        setMonthCrmDrag(next);
      },
      onPointerUp(e) {
        const m = monthCrmDragRef.current;
        if (!m || m.pointerId !== e.pointerId) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const { apt: dragApt, sourceDay, sx, sy } = m;
        monthCrmDragRef.current = null;
        setMonthCrmDrag(null);
        const dist = Math.hypot(e.clientX - sx, e.clientY - sy);
        const moved = dist >= 8;
        if (!moved) {
          skipNextMonthCrmClick.current = true;
          setDetail({ kind: "crm", apt: dragApt, x: e.clientX, y: e.clientY });
          return;
        }
        skipNextMonthCrmClick.current = true;
        const el = monthCellElFromPoint(e.clientX, e.clientY);
        const key = el?.dataset.monthDay;
        if (!key) return;
        const targetDay = parse(key, "yyyy-MM-dd", new Date());
        if (Number.isNaN(targetDay.getTime())) return;
        const delta = differenceInCalendarDays(startOfDay(targetDay), sourceDay);
        if (delta === 0) return;
        const newStart = addDays(new Date(dragApt.startAt), delta);
        handleCrmReschedule(dragApt, newStart);
      },
      onPointerCancel() {
        monthCrmDragRef.current = null;
        setMonthCrmDrag(null);
      },
      onClick(e) {
        if (skipNextMonthCrmClick.current) {
          skipNextMonthCrmClick.current = false;
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        setDetail({ kind: "crm", apt, x: e.clientX, y: e.clientY });
      },
    }),
    [handleCrmReschedule],
  );

  const bindMonthGoogleTimed = useCallback(
    (ev: GoogleEventDTO, cellDay: Date): MonthDragBind => ({
      onPointerDown(e) {
        if (e.button !== 0) return;
        e.stopPropagation();
        const btn = e.currentTarget;
        const rect = btn.getBoundingClientRect();
        const ghostWidth = Math.max(rect.width, 100);
        const ghostHeight = Math.max(rect.height, 30);
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        const next: MonthGoogleDragState = {
          ev,
          sourceDay: startOfDay(cellDay),
          pointerId: e.pointerId,
          sx: e.clientX,
          sy: e.clientY,
          ghostTop: rect.top,
          ghostLeft: rect.left,
          ghostWidth,
          ghostHeight,
          offsetX,
          offsetY,
        };
        monthGoogleDragRef.current = next;
        setMonthGoogleDrag(next);
        btn.setPointerCapture(e.pointerId);
      },
      onPointerMove(e) {
        const m = monthGoogleDragRef.current;
        if (!m || e.pointerId !== m.pointerId) return;
        const next: MonthGoogleDragState = {
          ...m,
          ghostTop: e.clientY - m.offsetY,
          ghostLeft: e.clientX - m.offsetX,
        };
        monthGoogleDragRef.current = next;
        setMonthGoogleDrag(next);
      },
      onPointerUp(e) {
        const m = monthGoogleDragRef.current;
        if (!m || m.pointerId !== e.pointerId) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const { ev: dragEv, sourceDay, sx, sy } = m;
        monthGoogleDragRef.current = null;
        setMonthGoogleDrag(null);
        const dist = Math.hypot(e.clientX - sx, e.clientY - sy);
        const moved = dist >= 8;
        if (!moved) {
          skipNextMonthGoogleClick.current = true;
          setDetail({ kind: "google", ev: dragEv, x: e.clientX, y: e.clientY });
          return;
        }
        skipNextMonthGoogleClick.current = true;
        const el = monthCellElFromPoint(e.clientX, e.clientY);
        const key = el?.dataset.monthDay;
        if (!key) return;
        const targetDay = parse(key, "yyyy-MM-dd", new Date());
        if (Number.isNaN(targetDay.getTime())) return;
        const delta = differenceInCalendarDays(startOfDay(targetDay), sourceDay);
        if (delta === 0) return;
        const newStart = addDays(new Date(dragEv.start), delta);
        handleGoogleReschedule(dragEv, newStart);
      },
      onPointerCancel() {
        monthGoogleDragRef.current = null;
        setMonthGoogleDrag(null);
      },
      onClick(e) {
        if (skipNextMonthGoogleClick.current) {
          skipNextMonthGoogleClick.current = false;
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        setDetail({ kind: "google", ev, x: e.clientX, y: e.clientY });
      },
    }),
    [handleGoogleReschedule],
  );

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const mergedAppointments = useMemo(
    () =>
      appointments.map((a) => {
        const o = crmTimeOverrides.get(a.id);
        return o ? { ...a, startAt: o.startAt, endAt: o.endAt } : a;
      }),
    [appointments, crmTimeOverrides],
  );

  const mergedGoogleEvents = useMemo(
    () =>
      googleEvents.map((e) => {
        const o = googleTimeOverrides.get(e.id);
        return o ? { ...e, start: o.start, end: o.end } : e;
      }),
    [googleEvents, googleTimeOverrides],
  );

  useEffect(() => {
    setCrmTimeOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [id, o] of prev) {
        const s = appointments.find((a) => a.id === id);
        if (s && sameInstant(s.startAt, o.startAt) && sameInstant(s.endAt, o.endAt)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [appointments]);

  useEffect(() => {
    setGoogleTimeOverrides((prev) => {
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      let changed = false;
      for (const [id, o] of prev) {
        const s = googleEvents.find((e) => e.id === id);
        if (s && sameInstant(s.start, o.start) && sameInstant(s.end, o.end)) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [googleEvents]);

  const timedGoogle = useMemo(() => mergedGoogleEvents.filter((e) => !e.allDay), [mergedGoogleEvents]);
  const allDayGoogle = useMemo(() => mergedGoogleEvents.filter((e) => e.allDay), [mergedGoogleEvents]);

  const hours = useMemo(
    () => Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i),
    [],
  );

  const colCount = headerDays.length;
  const gridTemplate = `52px repeat(${colCount}, minmax(0, 1fr))`;

  const prevLabel =
    view === "day" ? "Previous day" : view === "week" ? "Previous week" : "Previous month";
  const nextLabel = view === "day" ? "Next day" : view === "week" ? "Next week" : "Next month";

  return (
    <div className="w-full max-w-full overflow-hidden rounded-[24px] border border-[#dadce0] bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-[#dadce0] bg-[#f8f9fa] px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={goPrev}
              className="rounded-full p-2 text-slate-600 transition hover:bg-slate-200/80"
              aria-label={prevLabel}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToday}
              className="rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-sm font-medium text-[#3c4043] shadow-sm hover:bg-slate-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={goNext}
              className="rounded-full p-2 text-slate-600 transition hover:bg-slate-200/80"
              aria-label={nextLabel}
            >
              <ChevronRight className="h-5 w-5" />
            </button>

            <div className="ml-1 flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-[#dadce0] bg-white p-0.5 shadow-sm">
                {(["day", "week", "month"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => changeView(v)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition",
                      view === v
                        ? "bg-[#e8f0fe] text-[#1967d2]"
                        : "text-[#5f6368] hover:bg-slate-50",
                    )}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            <h2 className="min-w-0 text-lg font-normal text-[#3c4043]">
              <span className="block sm:inline">{titlePrimary}</span>
              <span className="mt-0.5 block text-sm font-normal text-[#70757a] sm:ml-2 sm:mt-0 sm:inline">
                {titleSecondary}
              </span>
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {googleConnected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f0fe] px-3 py-1 text-[#1967d2]">
                <Link2 className="h-3.5 w-3.5" />
                Google sync on
                {googleLoading ? <span className="text-xs text-[#1967d2]/80">(loading…)</span> : null}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-[#70757a]">
                <Link2Off className="h-3.5 w-3.5" />
                <a href="/settings" className="text-[#1a73e8] underline-offset-2 hover:underline">
                  Connect Google
                </a>
              </span>
            )}
          </div>
        </div>
        {canCreate ? (
          <p className="px-1 text-xs leading-relaxed text-[#5f6368]">
            <span className="font-medium text-[#3c4043]">Like Google Calendar:</span>{" "}
            <span className="font-medium">single-click</span> a time (or drag for duration) for the quick add dialog;{" "}
            <span className="font-medium">double-click</span> the same slot for the full editor.
            {canEditAppointments ? (
              <>
                {" "}
                <span className="font-medium">Drag</span> CRM or Google timed blocks to another time or another day
                in week/day view; the grid updates immediately, then saves in the background. In{" "}
                <span className="font-medium">month</span> view, drag a timed block to another day to move it by
                whole days (clock time stays the same).
              </>
            ) : null}{" "}
            CRM bookings sync to Google when connected; Google-only events use their Google Calendar colors.
          </p>
        ) : (
          <p className="px-1 text-xs text-[#70757a]">Your role can view the schedule here; create bookings from an account with booking permission.</p>
        )}
      </div>

      {googleError ? (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">{googleError}</p>
      ) : null}

      {allDayGoogle.length > 0 && view !== "month" ? (
        <div className="border-b border-[#dadce0] bg-[#f8f9fa] px-3 py-2">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[#70757a]">All day (Google)</p>
          <div className="flex flex-wrap gap-2">
            {allDayGoogle.map((e) => (
              (() => {
                const palette = googleEventPalette(e.colorId);
                return (
              <a
                key={e.id}
                href={e.htmlLink || "#"}
                target="_blank"
                rel="noreferrer"
                className="max-w-full truncate rounded border px-2 py-1 text-xs font-medium"
                style={{ borderColor: palette.border, backgroundColor: palette.bg, color: palette.text }}
              >
                {e.summary}
              </a>
                );
              })()
            ))}
          </div>
        </div>
      ) : null}

      {view === "month" ? (
        <div className="w-full overflow-x-auto">
          <div className="min-w-[720px]">
            <div className="grid grid-cols-7 border-b border-[#dadce0] bg-white">
              {WEEKDAY_LABELS.map((d) => (
                <div
                  key={d}
                  className="border-r border-[#dadce0] py-2 text-center text-[11px] font-medium uppercase text-[#70757a] last:border-r-0"
                >
                  {d}
                </div>
              ))}
            </div>
            {monthGrid.map((row, ri) => (
              <div key={ri} className="grid grid-cols-7">
                {row.map((cell) => (
                  <MonthCell
                    key={cell.toISOString()}
                    day={cell}
                    focusMonth={startOfMonth(cursor)}
                    appointments={mergedAppointments}
                    googleTimed={timedGoogle}
                    googleAllDay={allDayGoogle}
                    maxParallelBookings={maxParallelBookings}
                    slotUsage={slotUsage}
                    onOpenDay={goToDay}
                    bindMonthCrm={canEditAppointments ? bindMonthCrm : undefined}
                    bindMonthGoogleTimed={
                      canEditAppointments && googleConnected ? bindMonthGoogleTimed : undefined
                    }
                    monthCrmDraggingId={monthCrmDrag?.apt.id ?? null}
                    monthGoogleDraggingId={monthGoogleDrag?.ev.id ?? null}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <div className="min-w-[640px]">
            <div className="grid border-b border-[#dadce0]" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="border-r border-[#dadce0] bg-white" />
              {headerDays.map((d) => {
                const isToday = isSameDay(d, new Date());
                return (
                  <div
                    key={d.toISOString()}
                    className={cn(
                      "border-r border-[#dadce0] px-1 py-2 text-center last:border-r-0",
                      isToday ? "bg-[#e8f0fe]" : "bg-white",
                    )}
                  >
                    <p className="text-[11px] font-medium uppercase text-[#70757a]">{format(d, "EEE")}</p>
                    <button
                      type="button"
                      onClick={() => goToDay(d)}
                      title="Day view"
                      className={cn(
                        "mt-0.5 w-full text-[22px] font-normal tabular-nums transition hover:opacity-80",
                        isToday ? "text-[#1967d2]" : "text-[#3c4043]",
                      )}
                    >
                      {format(d, "d")}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="grid" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="relative border-r border-[#dadce0] bg-white">
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-b border-[#dadce0]/60 pr-1 text-right text-[10px] leading-none text-[#70757a]"
                    style={{ height: PX_PER_HOUR, paddingTop: 2 }}
                  >
                    {format(new Date(2000, 0, 1, h), "h a")}
                  </div>
                ))}
              </div>

              {headerDays.map((day) => (
                <DayTimeColumn
                  key={day.toISOString()}
                  day={day}
                  appointments={mergedAppointments}
                  timedGoogle={timedGoogle}
                  maxParallelBookings={maxParallelBookings}
                  slotUsage={slotUsage}
                  canCreate={canCreate}
                  defaultDurationMins={defaultDurationMins}
                  canEditAppointments={canEditAppointments}
                  googleReschedulable={canEditAppointments && googleConnected}
                  onSlotRelease={handleSlotRelease}
                  onCrmOpen={(apt, x, y) => setDetail({ kind: "crm", apt, x, y })}
                  onCrmReschedule={handleCrmReschedule}
                  onGoogleOpen={(ev, x, y) => setDetail({ kind: "google", ev, x, y })}
                  onGoogleReschedule={handleGoogleReschedule}
                  hours={hours}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      <AppointmentQuickCreateDialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) setPrefillFromCall(null);
        }}
        initialStart={createStart}
        initialDurationMins={createDuration}
        clients={formClients}
        typeOptions={bookingTypeFormOptions}
        onRequestFullEditor={openFullEditorFromDialog}
        prefillFromCall={prefillFromCall}
        productServiceOptions={productServiceOptionsForBooking ?? []}
      />

      {detail ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[90] cursor-default bg-transparent"
            aria-label="Close"
            onClick={() => setDetail(null)}
          />
          <div
            className="fixed z-[100] w-[min(100vw-2rem,24rem)] rounded-xl border border-[#dadce0] bg-white p-3 shadow-2xl"
            style={bookingDetailPopoverStyle(detail.x, detail.y)}
          >
            {detail.kind === "crm" ? (
              <>
                <p className="text-sm font-semibold text-[#3c4043]">{detail.apt.title}</p>
                <p className="mt-1 text-xs text-[#5f6368]">
                  {format(new Date(detail.apt.startAt), "EEE MMM d · h:mm a")} –{" "}
                  {format(new Date(detail.apt.endAt), "h:mm a")}
                </p>
                <p className="mt-1 text-sm text-[#3c4043]">{detail.apt.clientName}</p>
                {detail.apt.clientPhone?.trim() ? (
                  <p className="mt-0.5 text-sm">
                    <a
                      href={`tel:${normalizePhone(detail.apt.clientPhone) || detail.apt.clientPhone.replace(/\D/g, "")}`}
                      className="font-medium text-[#1a73e8] hover:underline"
                    >
                      {detail.apt.clientPhone.trim()}
                    </a>
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-[#70757a]">
                  {detail.apt.typeLabel} · {detail.apt.resourceKey} · {detail.apt.status}
                </p>
                {detail.apt.googleSyncStatus === "FAILED" ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200">
                    Google did not accept the last update. Use <strong>Save times</strong> or{" "}
                    <strong>Full edit</strong> to retry, and confirm Google is connected in Settings.
                  </p>
                ) : null}
                {detail.apt.notes ? (
                  <p className="mt-2 line-clamp-4 text-xs text-[#5f6368]">{detail.apt.notes}</p>
                ) : null}
                {formatDepositLabel(detail.apt.depositText) ? (
                  <p className="mt-2 text-xs font-medium text-[#137333]">
                    Deposit (legacy field): {formatDepositLabel(detail.apt.depositText)}
                  </p>
                ) : null}
                {detail.apt.callLogId ? (
                  <p className="mt-2 text-xs text-[#5f6368]">
                    <span className="text-[#70757a]">From call — </span>
                    <Link
                      href={`/clients/${detail.apt.clientId}#call-log-${detail.apt.callLogId}`}
                      className="font-semibold text-[#1a73e8] hover:underline"
                    >
                      client timeline
                    </Link>
                  </p>
                ) : null}
                {canEditAppointments ? (
                  <CrmQuickTimeAdjust
                    apt={detail.apt}
                    onSaveBanner={showSaveBanner}
                    onOptimisticApply={(startIso, endIso) => {
                      setCrmTimeOverrides((prev) => {
                        const next = new Map(prev);
                        next.set(detail.apt.id, { startAt: startIso, endAt: endIso });
                        return next;
                      });
                    }}
                    onOptimisticRevert={() => {
                      setCrmTimeOverrides((prev) => {
                        const next = new Map(prev);
                        next.delete(detail.apt.id);
                        return next;
                      });
                    }}
                    onSaved={() => {
                      router.refresh();
                      setDetail(null);
                    }}
                  />
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  {canEditAppointments ? (
                    <Link
                      href={`/appointments/${detail.apt.id}/edit`}
                      className="rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-xs font-semibold text-[#1967d2] hover:bg-[#f1f3f4]"
                      onClick={() => setDetail(null)}
                    >
                      Full edit
                    </Link>
                  ) : null}
                  <Link
                    href={`/clients/${detail.apt.clientId}`}
                    className="rounded-lg border border-[#dadce0] bg-white px-3 py-1.5 text-xs font-semibold text-[#1967d2] hover:bg-[#f1f3f4]"
                    onClick={() => setDetail(null)}
                  >
                    Open client
                  </Link>
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="rounded-lg border border-[#dadce0] px-3 py-1.5 text-xs font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                  >
                    Close
                  </button>
                </div>
                {canEditAppointments ? (
                  <CrmCalendarDeleteBooking
                    aptId={detail.apt.id}
                    aptTitle={detail.apt.title}
                    showSaveBanner={showSaveBanner}
                    onDone={() => {
                      setDetail(null);
                      void router.refresh();
                    }}
                  />
                ) : null}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold" style={{ color: googleEventPalette(detail.ev.colorId).text }}>
                  {detail.ev.summary}
                </p>
                <p className="mt-1 text-xs text-[#5f6368]">
                  {format(new Date(detail.ev.start), "EEE MMM d · h:mm a")} –{" "}
                  {format(new Date(detail.ev.end), "h:mm a")}
                </p>
                <p className="mt-1 text-xs text-[#70757a]">Google Calendar</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {detail.ev.htmlLink ? (
                    (() => {
                      const palette = googleEventPalette(detail.ev.colorId);
                      return (
                    <a
                      href={detail.ev.htmlLink}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg px-3 py-1.5 text-xs font-semibold"
                      style={{ backgroundColor: palette.buttonBg, color: palette.buttonText }}
                      onMouseEnter={(ev) => {
                        ev.currentTarget.style.backgroundColor = palette.buttonHover;
                      }}
                      onMouseLeave={(ev) => {
                        ev.currentTarget.style.backgroundColor = palette.buttonBg;
                      }}
                      onClick={() => setDetail(null)}
                    >
                      Open in Google
                    </a>
                      );
                    })()
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setDetail(null)}
                    className="rounded-lg border border-[#dadce0] px-3 py-1.5 text-xs font-medium text-[#5f6368] hover:bg-[#f1f3f4]"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}

      {view === "month" && monthCrmDrag ? (
        <div
          className="pointer-events-none fixed z-[40] overflow-hidden rounded px-1 py-0.5 shadow-lg ring-2 ring-[#1a73e8]"
          style={{
            ...monthCrmDrag.blockCss,
            top: monthCrmDrag.ghostTop,
            left: monthCrmDrag.ghostLeft,
            width: monthCrmDrag.ghostWidth,
            height: monthCrmDrag.ghostHeight,
          }}
          aria-hidden
        >
          <p
            className="truncate text-[11px] font-semibold leading-tight"
            style={{ color: monthCrmDrag.apt.typeColorHex }}
          >
            {monthCrmDrag.apt.title}
          </p>
          <p className="truncate text-[10px] text-[#3c4043]">{monthCrmDrag.apt.clientName}</p>
          <p className="truncate text-[9px] font-medium text-[#1967d2]">Moving…</p>
        </div>
      ) : null}
      {view === "month" && monthGoogleDrag ? (
        <div
          className="pointer-events-none fixed z-[40] overflow-hidden rounded border-2 border-[#1a73e8] px-1 py-0.5 shadow-lg"
          style={{
            ...googleEventBlockStyle(monthGoogleDrag.ev.colorId),
            top: monthGoogleDrag.ghostTop,
            left: monthGoogleDrag.ghostLeft,
            width: monthGoogleDrag.ghostWidth,
            height: monthGoogleDrag.ghostHeight,
          }}
          aria-hidden
        >
          <p
            className="truncate text-[11px] font-semibold leading-tight"
            style={{ color: googleEventPalette(monthGoogleDrag.ev.colorId).text }}
          >
            {monthGoogleDrag.ev.summary}
          </p>
          <p className="truncate text-[10px] text-[#3c4043]">Google Calendar</p>
          <p className="truncate text-[9px] font-medium text-[#1967d2]">Moving…</p>
        </div>
      ) : null}

      {saveBanner.kind !== "hidden" ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[320] flex justify-center px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-6"
          role="status"
          aria-live="polite"
        >
          <div
            className={cn(
              "pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 shadow-2xl",
              saveBanner.kind === "saving" && "border-[#1a73e8]/40 bg-[#e8f0fe] text-[#174ea6]",
              saveBanner.kind === "success" && "border-emerald-200 bg-emerald-50 text-emerald-950",
              saveBanner.kind === "error" && "border-red-200 bg-red-50 text-red-950",
            )}
          >
            {saveBanner.kind === "saving" ? (
              <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" aria-hidden />
            ) : saveBanner.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden />
            ) : (
              <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden />
            )}
            <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{saveBanner.message}</p>
            <button
              type="button"
              onClick={dismissSaveBanner}
              className="shrink-0 rounded-lg p-1 text-current opacity-70 hover:bg-black/5 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
