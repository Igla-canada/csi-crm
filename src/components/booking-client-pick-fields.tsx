"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AppointmentFormClientOption } from "@/lib/crm-types";
import { cn } from "@/lib/crm-shared";

const MIN_PHONE_DIGITS = 2;
const MAX_SUGGESTIONS = 10;

function filterByPhone(clients: AppointmentFormClientOption[], query: string): AppointmentFormClientOption[] {
  const digits = query.replace(/\D/g, "");
  if (digits.length < MIN_PHONE_DIGITS) return [];
  const out: AppointmentFormClientOption[] = [];
  for (const c of clients) {
    const hit = c.phones.some(
      (p) =>
        p.normalized.includes(digits) || p.value.replace(/\D/g, "").includes(digits),
    );
    if (hit) out.push(c);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

function filterByName(clients: AppointmentFormClientOption[], query: string): AppointmentFormClientOption[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  return clients.filter((c) => c.displayName.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS);
}

function pickPhoneForClient(c: AppointmentFormClientOption): string {
  return c.phones[0]?.value ?? "";
}

export type BookingClientPickFieldsProps = {
  clients: AppointmentFormClientOption[];
  clientId: string;
  onClientIdChange: (id: string) => void;
  phone: string;
  onPhoneChange: (v: string) => void;
  displayName: string;
  onDisplayNameChange: (v: string) => void;
  /** Tighter spacing and inputs (e.g. calendar quick-create). */
  compact?: boolean;
};

export function BookingClientPickFields({
  clients,
  clientId,
  onClientIdChange,
  phone,
  onPhoneChange,
  displayName,
  onDisplayNameChange,
  compact = false,
}: BookingClientPickFieldsProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [phoneOpen, setPhoneOpen] = useState(false);
  const [nameOpen, setNameOpen] = useState(false);

  const phoneMatches = useMemo(() => filterByPhone(clients, phone), [clients, phone]);
  const nameMatches = useMemo(() => filterByName(clients, displayName), [clients, displayName]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setPhoneOpen(false);
        setNameOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const pickClient = (c: AppointmentFormClientOption) => {
    onClientIdChange(c.id);
    onPhoneChange(pickPhoneForClient(c));
    onDisplayNameChange(c.displayName);
    setPhoneOpen(false);
    setNameOpen(false);
  };

  const suggestionListClass = cn(
    "absolute left-0 right-0 top-full z-[110] mt-1 overflow-auto rounded-lg border border-[#dadce0] bg-white py-1 shadow-lg",
    compact ? "max-h-36" : "max-h-48",
  );

  const inputClass = cn(
    "w-full rounded-lg border border-[#dadce0] bg-white px-3 text-sm text-[#3c4043] outline-none focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]",
    compact ? "mt-0.5 py-2" : "mt-1 py-2.5",
  );

  return (
    <div ref={rootRef} className={compact ? "space-y-2" : "space-y-4"}>
      <div className="relative">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Phone</span>
          <input
            type="text"
            inputMode="tel"
            autoComplete="off"
            value={phone}
            onChange={(e) => {
              const v = e.target.value;
              const prevLinked = clientId ? clients.find((c) => c.id === clientId) : undefined;
              if (!prevLinked) {
                if (clientId) onClientIdChange("");
              } else {
                const digits = v.replace(/\D/g, "");
                if (digits.length > 0) {
                  const matches = prevLinked.phones.some(
                    (p) =>
                      Boolean(p.normalized) &&
                      (p.normalized.includes(digits) || digits.includes(p.normalized)),
                  );
                  if (!matches) onClientIdChange("");
                }
              }
              onPhoneChange(v);
              setPhoneOpen(true);
              setNameOpen(false);
            }}
            onFocus={() => {
              setPhoneOpen(true);
              setNameOpen(false);
            }}
            placeholder="Type to search or enter a new number…"
            className={inputClass}
            aria-autocomplete="list"
            aria-expanded={phoneOpen && phoneMatches.length > 0}
          />
        </label>
        {phoneOpen && phoneMatches.length > 0 ? (
          <ul className={suggestionListClass} role="listbox">
            {phoneMatches.map((c) => (
              <li key={c.id} role="option">
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#f1f3f4]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickClient(c)}
                >
                  <span className="font-medium text-[#3c4043]">{pickPhoneForClient(c) || "—"}</span>
                  <span className="text-xs text-[#5f6368]">{c.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="relative">
        <label className="block">
          <span className="text-xs font-medium uppercase tracking-wide text-[#70757a]">Client name</span>
          <input
            type="text"
            autoComplete="off"
            value={displayName}
            onChange={(e) => {
              const v = e.target.value;
              const prevLinked = clientId ? clients.find((c) => c.id === clientId) : undefined;
              if (clientId && !prevLinked) {
                onClientIdChange("");
              } else if (
                prevLinked &&
                v.trim().toLowerCase() !== prevLinked.displayName.trim().toLowerCase()
              ) {
                onClientIdChange("");
              }
              onDisplayNameChange(v);
              setNameOpen(true);
              setPhoneOpen(false);
            }}
            onFocus={() => {
              setNameOpen(true);
              setPhoneOpen(false);
            }}
            placeholder="Type to search or enter a new name…"
            className={inputClass}
            aria-autocomplete="list"
            aria-expanded={nameOpen && nameMatches.length > 0}
          />
        </label>
        {nameOpen && nameMatches.length > 0 ? (
          <ul className={suggestionListClass} role="listbox">
            {nameMatches.map((c) => (
              <li key={c.id} role="option">
                <button
                  type="button"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[#f1f3f4]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickClient(c)}
                >
                  <span className="font-medium text-[#3c4043]">{c.displayName}</span>
                  {pickPhoneForClient(c) ? (
                    <span className="text-xs text-[#5f6368]">{pickPhoneForClient(c)}</span>
                  ) : (
                    <span className="text-xs text-[#70757a]">No phone on file</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {clientId ? (
        <p className="text-xs text-[#137333]">Linked to an existing client — change either field above to create a different one.</p>
      ) : (
        <p className="text-xs text-[#5f6368]">
          Pick a suggestion to link this booking, or leave as typed to create a new client (duplicate names are allowed).
        </p>
      )}
    </div>
  );
}
