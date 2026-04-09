"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/crm-shared";

const MAX_SUGGESTIONS = 10;

function filterVehicles(vehicles: Array<{ id: string; label: string }>, query: string) {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  return vehicles.filter((v) => v.label.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
}

type Props = {
  /** Vehicles for the selected client (empty if new client or none on file). */
  vehicles: Array<{ id: string; label: string }>;
  vehicleId: string;
  vehicleText: string;
  onVehicleIdChange: (id: string) => void;
  onVehicleTextChange: (text: string) => void;
  compact?: boolean;
};

export function BookingVehiclePickField({
  vehicles,
  vehicleId,
  vehicleText,
  onVehicleIdChange,
  onVehicleTextChange,
  compact = false,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const matches = useMemo(() => filterVehicles(vehicles, vehicleText), [vehicles, vehicleText]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pick = (v: { id: string; label: string }) => {
    onVehicleIdChange(v.id);
    onVehicleTextChange(v.label);
    setOpen(false);
  };

  const listClass = cn(
    "absolute left-0 right-0 top-full z-[110] mt-1 overflow-auto rounded-lg border border-[#dadce0] bg-white py-1 shadow-lg",
    compact ? "max-h-36" : "max-h-44",
  );

  const inputClass = cn(
    "w-full rounded-lg border border-[#dadce0] bg-white px-3 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]",
    compact ? "mt-0.5 py-2" : "mt-1 py-2.5",
  );

  return (
    <div ref={rootRef} className="relative">
      <label className="block">
        <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Vehicle (optional)</span>
        <input
          type="text"
          autoComplete="off"
          value={vehicleText}
          onChange={(e) => {
            onVehicleIdChange("");
            onVehicleTextChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Type to search or enter a new vehicle…"
          className={inputClass}
          aria-autocomplete="list"
          aria-expanded={open && matches.length > 0}
        />
      </label>
      {open && matches.length > 0 ? (
        <ul className={listClass} role="listbox">
          {matches.map((v) => (
            <li key={v.id} role="option">
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-sm text-[#3c4043] hover:bg-[#f1f3f4]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(v)}
              >
                {v.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {vehicleId ? (
        <p className={cn("text-xs text-[#137333]", compact ? "mt-0.5" : "mt-1")}>
          Linked to a saved vehicle — edit text to use a different one.
        </p>
      ) : vehicleText.trim().length >= 2 ? (
        <p className={cn("text-xs text-[#5f6368]", compact ? "mt-0.5" : "mt-1")}>
          No match selected — a new vehicle will be saved for this client when you save the booking.
        </p>
      ) : null}
    </div>
  );
}
