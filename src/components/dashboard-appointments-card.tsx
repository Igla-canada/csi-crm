"use client";

import {
  addDays,
  addMonths,
  addWeeks,
  format,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { cn } from "@/lib/crm-shared";

const WEEK_STARTS_ON = 0 as const;
const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type DashboardAppointmentDTO = {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  resourceKey: string | null;
  clientDisplayName: string;
};

type ViewMode = "day" | "week" | "month";

function normalizeCursorForView(c: Date, v: ViewMode): Date {
  if (v === "day") return startOfDay(c);
  if (v === "week") return startOfWeek(c, { weekStartsOn: WEEK_STARTS_ON });
  return startOfMonth(c);
}

function appointmentsForDay(
  items: Array<DashboardAppointmentDTO & { start: Date }>,
  day: Date,
): Array<DashboardAppointmentDTO & { start: Date }> {
  return items.filter((a) => isSameDay(a.start, day)).sort((x, y) => x.start.getTime() - y.start.getTime());
}

function AppointmentBlock({ appointment: a }: { appointment: DashboardAppointmentDTO & { start: Date } }) {
  return (
    <div className="crm-soft-row grid gap-2 rounded-xl p-3 sm:grid-cols-[minmax(0,4.5rem)_1fr_auto] sm:items-start">
      <div>
        <p className="text-xs font-semibold text-slate-900">{format(a.start, "h:mm a")}</p>
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{a.title}</p>
        <p className="mt-0.5 truncate text-xs text-slate-600">{a.clientDisplayName}</p>
      </div>
      {a.resourceKey ? (
        <p className="text-xs text-slate-500 sm:text-right">{a.resourceKey}</p>
      ) : (
        <span className="hidden sm:block" />
      )}
    </div>
  );
}

export function DashboardAppointmentsCard({ appointments }: { appointments: DashboardAppointmentDTO[] }) {
  const items = useMemo(
    () =>
      appointments.map((a) => ({
        ...a,
        start: new Date(a.startAt),
        end: new Date(a.endAt),
      })),
    [appointments],
  );

  const [view, setView] = useState<ViewMode>("day");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));

  const changeView = useCallback((v: ViewMode) => {
    setView(v);
    setCursor((c) => normalizeCursorForView(c, v));
  }, []);

  const goToday = useCallback(() => {
    const t = new Date();
    if (view === "day") setCursor(startOfDay(t));
    else if (view === "week") setCursor(startOfWeek(t, { weekStartsOn: WEEK_STARTS_ON }));
    else setCursor(startOfMonth(t));
  }, [view]);

  const goPrev = useCallback(() => {
    setCursor((c) => {
      if (view === "day") return addDays(startOfDay(c), -1);
      if (view === "week") return addWeeks(startOfWeek(c, { weekStartsOn: WEEK_STARTS_ON }), -1);
      return addMonths(startOfMonth(c), -1);
    });
  }, [view]);

  const goNext = useCallback(() => {
    setCursor((c) => {
      if (view === "day") return addDays(startOfDay(c), 1);
      if (view === "week") return addWeeks(startOfWeek(c, { weekStartsOn: WEEK_STARTS_ON }), 1);
      return addMonths(startOfMonth(c), 1);
    });
  }, [view]);

  const weekDays = useMemo(() => {
    const ws = startOfWeek(cursor, { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  }, [cursor]);

  const monthCells = useMemo(() => {
    const ms = startOfMonth(cursor);
    const gridStart = startOfWeek(ms, { weekStartsOn: WEEK_STARTS_ON });
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [cursor]);

  const titlePrimary = useMemo(() => {
    if (view === "day") return format(cursor, "EEEE, MMM d, yyyy");
    if (view === "week") {
      const ws = weekDays[0]!;
      const we = weekDays[6]!;
      if (ws.getFullYear() === we.getFullYear()) {
        return `${format(ws, "MMM d")} – ${format(we, "MMM d, yyyy")}`;
      }
      return `${format(ws, "MMM d, yyyy")} – ${format(we, "MMM d, yyyy")}`;
    }
    return format(cursor, "MMMM yyyy");
  }, [view, cursor, weekDays]);

  const prevLabel = view === "day" ? "Previous day" : view === "week" ? "Previous week" : "Previous month";
  const nextLabel = view === "day" ? "Next day" : view === "week" ? "Next week" : "Next month";

  const dayList = useMemo(() => appointmentsForDay(items, cursor), [items, cursor]);

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="rounded-[20px] bg-[#eaf2fb] p-3 text-[#1e5ea8]">
            <CalendarClock className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Upcoming appointments</p>
            <h3 className="mt-1 text-[1.55rem] font-semibold tracking-tight text-slate-900">What is booked next</h3>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Switch between day, week, and month. Data is from CRM bookings in the surrounding months (not Google-only
              events). Open Bookings for the full calendar.
            </p>
          </div>
        </div>
        <Link href="/appointments" className="shrink-0 text-sm font-medium text-[#1e5ea8] hover:text-[#17497f]">
          View all
        </Link>
      </div>

      <div className="mt-5 flex flex-col gap-3 border-b border-slate-200/90 pb-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100"
            aria-label={prevLabel}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goNext}
            className="rounded-full p-2 text-slate-600 transition hover:bg-slate-100"
            aria-label={nextLabel}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="ml-1 flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
            {(["day", "week", "month"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => changeView(v)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium capitalize transition",
                  view === v ? "bg-[#e8f0fe] text-[#1967d2]" : "text-slate-600 hover:bg-slate-50",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <p className="text-sm font-medium text-slate-700">{titlePrimary}</p>
      </div>

      <div className="mt-5">
        {view === "day" ? (
          <div className="max-h-[min(28rem,55vh)] space-y-2 overflow-y-auto pr-1">
            {dayList.length ? (
              dayList.map((a) => <AppointmentBlock key={a.id} appointment={a} />)
            ) : (
              <div className="crm-soft-row rounded-[22px] p-4 text-sm text-slate-600">No bookings on this day.</div>
            )}
          </div>
        ) : null}

        {view === "week" ? (
          <div className="grid gap-3 md:grid-cols-7">
            {weekDays.map((day) => {
              const dayApts = appointmentsForDay(items, day);
              const isToday = isSameDay(day, new Date());
              return (
                <div
                  key={day.toISOString()}
                  className={cn(
                    "flex min-h-[140px] flex-col rounded-[18px] border border-slate-200/80 bg-slate-50/30 p-2",
                    isToday && "ring-2 ring-[#1e5ea8]/25",
                  )}
                >
                  <p className={cn("text-center text-xs font-semibold", isToday ? "text-[#1e5ea8]" : "text-slate-700")}>
                    {format(day, "EEE d")}
                  </p>
                  <div className="mt-2 flex max-h-[min(20rem,40vh)] flex-col gap-1.5 overflow-y-auto">
                    {dayApts.length ? (
                      dayApts.map((a) => (
                        <div
                          key={a.id}
                          className="rounded-lg border border-slate-200/90 bg-white px-2 py-1.5 text-[11px] leading-snug shadow-sm"
                        >
                          <p className="font-semibold text-slate-900">{format(a.start, "h:mm a")}</p>
                          <p className="mt-0.5 truncate text-slate-800">{a.title}</p>
                          <p className="truncate text-slate-500">{a.clientDisplayName}</p>
                        </div>
                      ))
                    ) : (
                      <p className="py-2 text-center text-[11px] text-slate-400">—</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {view === "month" ? (
          <div>
            <div className="grid grid-cols-7 gap-0.5 border-b border-slate-200 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {WEEKDAY_LABELS.map((d) => (
                <div key={d} className="py-1 text-center">
                  {d}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 pt-1">
              {monthCells.map((cell) => {
                const inMonth = isSameMonth(cell, cursor);
                const isToday = isSameDay(cell, new Date());
                const cellApts = appointmentsForDay(items, cell);
                const show = cellApts.slice(0, 3);
                const more = cellApts.length - show.length;
                return (
                  <div
                    key={cell.toISOString()}
                    className={cn(
                      "flex min-h-[5.5rem] flex-col rounded-lg border border-slate-100 bg-white p-1",
                      !inMonth && "bg-slate-50/80 opacity-60",
                      isToday && "ring-1 ring-[#1e5ea8]/35",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setView("day");
                        setCursor(startOfDay(cell));
                      }}
                      className={cn(
                        "mb-0.5 w-full rounded px-0.5 text-left text-xs font-semibold hover:bg-slate-100",
                        isToday ? "text-[#1e5ea8]" : "text-slate-800",
                      )}
                      title="Open day view"
                    >
                      {format(cell, "d")}
                    </button>
                    <ul className="min-h-0 flex-1 space-y-0.5 overflow-hidden text-[10px] leading-tight">
                      {show.map((a) => (
                        <li key={a.id} className="truncate text-slate-700" title={`${a.title} · ${a.clientDisplayName}`}>
                          <span className="font-medium text-slate-900">{format(a.start, "h:mm a")}</span> {a.title}
                        </li>
                      ))}
                      {more > 0 ? (
                        <li className="text-slate-500">
                          +{more} more —{" "}
                          <button
                            type="button"
                            className="font-medium text-[#1e5ea8] hover:underline"
                            onClick={() => {
                              setView("day");
                              setCursor(startOfDay(cell));
                            }}
                          >
                            day view
                          </button>
                        </li>
                      ) : null}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
