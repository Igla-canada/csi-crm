"use client";

import {
  createBookingTypeOptionAction,
  removeBookingTypeOptionAction,
  saveAllBookingTypeOptionsAction,
  setBookingTypeActiveAction,
  type BookingTypeOptionSaveRow,
} from "@/app/actions";
import { CallResultAccentPicker } from "@/components/call-result-accent-picker";
import {
  bookingTypeBadgePresentation,
  normalizeStoredAccentHex,
  resolveBookingTypeAccentKey,
  type CallResultAccentKey,
} from "@/lib/call-result-accents";
import { cn } from "@/lib/crm-shared";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

export type BookingTypeOptionRow = {
  code: string;
  label: string;
  isBuiltIn: boolean;
  active: boolean;
  accentKey: string | null;
  accentHex?: string | null;
};

type RowDraft = {
  label: string;
  accentKey: CallResultAccentKey;
  accentHex: string;
};

type BookingTypesSettingsProps = {
  options: BookingTypeOptionRow[];
};

function buildDraftsFromOptions(opts: BookingTypeOptionRow[]): Record<string, RowDraft> {
  return Object.fromEntries(
    opts.map((o) => [
      o.code,
      {
        label: o.label,
        accentKey: resolveBookingTypeAccentKey(o.accentKey, o.code),
        accentHex: normalizeStoredAccentHex(o.accentHex) ?? "",
      } satisfies RowDraft,
    ]),
  );
}

function BookingTypeRow({
  opt,
  draft,
  onLabelChange,
  onAccentChange,
}: {
  opt: BookingTypeOptionRow;
  draft: RowDraft;
  onLabelChange: (code: string, label: string) => void;
  onAccentChange: (code: string, key: CallResultAccentKey, hex: string) => void;
}) {
  const previewBadge = bookingTypeBadgePresentation(
    draft.accentHex.trim() !== "" ? draft.accentHex : null,
    draft.accentKey,
    opt.code,
  );

  const pickerKey = `${opt.code}:${opt.accentKey ?? ""}:${opt.accentHex ?? ""}`;

  const handleAccent = useCallback(
    (key: CallResultAccentKey, hex: string) => {
      onAccentChange(opt.code, key, hex);
    },
    [onAccentChange, opt.code],
  );

  return (
    <tr className="border-b border-slate-100 align-middle last:border-b-0">
      <td className="px-4 py-4 sm:px-5">
        <label className="mb-1 block text-xs font-medium text-slate-500 md:sr-only">
          Label {opt.isBuiltIn ? "(built-in)" : "(custom)"}
        </label>
        <input
          type="text"
          value={draft.label}
          onChange={(e) => onLabelChange(opt.code, e.target.value)}
          minLength={2}
          required
          className="w-full min-w-[10rem] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
        />
      </td>
      <td className="px-4 py-4 sm:px-5 md:w-[260px]">
        <span className="mb-1 block text-xs font-medium text-slate-500 md:sr-only">Color</span>
        <CallResultAccentPicker
          key={pickerKey}
          defaultAccentKey={resolveBookingTypeAccentKey(opt.accentKey, opt.code)}
          defaultAccentHex={normalizeStoredAccentHex(opt.accentHex)}
          onAccentChange={handleAccent}
        />
      </td>
      <td className="px-4 py-4 sm:px-5">
        <span className="mb-1 block text-xs font-medium text-slate-500 md:sr-only">Preview</span>
        <span
          className={previewBadge.className}
          style={previewBadge.style}
          title={`Internal code: ${opt.code}`}
        >
          {draft.label.trim() || "—"}
        </span>
      </td>
      <td className="px-4 py-4 sm:px-5">
        <span className="mb-2 block text-xs font-medium text-slate-500 md:sr-only">Actions</span>
        <div className="flex flex-wrap items-center gap-2">
          <form action={setBookingTypeActiveAction} className="inline">
            <input type="hidden" name="code" value={opt.code} />
            <input type="hidden" name="active" value={opt.active ? "false" : "true"} />
            <button
              type="submit"
              title={
                opt.active
                  ? "Hide this type when creating new bookings"
                  : "Show this type again for new bookings"
              }
              className={cn(
                "min-w-[4.25rem] rounded-xl border px-3 py-2 text-xs font-semibold transition",
                opt.active
                  ? "border-rose-200/90 bg-rose-50 text-rose-800 hover:border-rose-300 hover:bg-rose-100/90"
                  : "border-emerald-200/90 bg-emerald-50 text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100/90",
              )}
            >
              {opt.active ? "Hide" : "Show"}
            </button>
          </form>
          {opt.isBuiltIn ? (
            <button
              type="button"
              disabled
              title="Built-in types can’t be deleted — hide them from new bookings instead."
              className="cursor-not-allowed rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-400"
            >
              Delete
            </button>
          ) : (
            <form action={removeBookingTypeOptionAction} className="inline">
              <input type="hidden" name="code" value={opt.code} />
              <button
                type="submit"
                className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900 transition hover:border-red-400 hover:bg-red-100"
              >
                Delete
              </button>
            </form>
          )}
        </div>
      </td>
    </tr>
  );
}

export function BookingTypesSettings({ options }: BookingTypesSettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => buildDraftsFromOptions(options));

  const onLabelChange = useCallback((code: string, label: string) => {
    setDrafts((d) => (d[code] ? { ...d, [code]: { ...d[code], label } } : d));
  }, []);

  const onAccentChange = useCallback((code: string, key: CallResultAccentKey, hex: string) => {
    setDrafts((d) => (d[code] ? { ...d, [code]: { ...d[code], accentKey: key, accentHex: hex } } : d));
  }, []);

  const saveAll = useCallback(() => {
    setSaveError(null);
    const rows: BookingTypeOptionSaveRow[] = options.map((o) => {
      const d = drafts[o.code];
      if (!d) {
        return {
          code: o.code,
          label: o.label,
          accentKey: resolveBookingTypeAccentKey(o.accentKey, o.code),
          accentHex: normalizeStoredAccentHex(o.accentHex),
        };
      }
      return {
        code: o.code,
        label: d.label.trim(),
        accentKey: d.accentKey,
        accentHex: d.accentHex.trim() === "" ? null : d.accentHex.trim(),
      };
    });

    for (const r of rows) {
      if (r.label.length < 2) {
        setSaveError(`"${r.code}": enter a label with at least 2 characters.`);
        return;
      }
    }

    startTransition(() => {
      void saveAllBookingTypeOptionsAction(rows)
        .then((result) => {
          if (result?.ok === false) {
            setSaveError(result.message);
            return;
          }
          router.refresh();
        })
        .catch(() => {
          setSaveError("Could not reach the server. Check your connection and try again.");
        });
    });
  }, [drafts, options, router]);

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">
        Labels and colors apply to the Bookings calendar and the booking dialog. Edit below, then use{" "}
        <span className="font-medium text-slate-800">Save all changes</span> once. Hide/show and Delete run immediately.
      </p>

      <section className="rounded-[22px] border border-slate-200/90 bg-slate-50/40 p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-slate-800">Add custom booking type</h4>
        <p className="mt-1 text-xs text-slate-500">Creates a new type as soon as you submit this row.</p>
        <form
          action={createBookingTypeOptionAction}
          className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(200px,240px)_auto] sm:items-end"
        >
          <div className="min-w-0">
            <label htmlFor="new-booking-type" className="mb-1 block text-xs font-medium text-slate-600">
              Label
            </label>
            <input
              id="new-booking-type"
              name="label"
              type="text"
              required
              placeholder="e.g. Remote diagnostic"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <div className="min-w-0">
            <span className="mb-1 block text-xs font-medium text-slate-600">Color</span>
            <CallResultAccentPicker defaultAccentKey="slate" defaultAccentHex={null} />
          </div>
          <button
            type="submit"
            className="h-[42px] rounded-xl bg-[#1e5ea8] px-5 text-sm font-semibold text-white transition hover:bg-[#17497f] sm:self-end"
          >
            Add type
          </button>
        </form>
      </section>

      <section className="overflow-hidden rounded-[22px] border border-slate-200/90 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-slate-50/80 px-4 py-3 sm:px-5">
          <h4 className="text-sm font-semibold text-slate-800">All booking types</h4>
          <p className="mt-0.5 text-xs text-slate-500">Scroll horizontally on small screens.</p>
        </div>

        {saveError ? (
          <div
            role="alert"
            className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm font-medium text-red-900 sm:px-5"
          >
            {saveError}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-white text-[0.65rem] font-bold uppercase tracking-[0.12em] text-slate-500">
                <th className="px-4 py-3 sm:px-5">Label</th>
                <th className="px-4 py-3 sm:px-5 md:w-[260px]">Color</th>
                <th className="px-4 py-3 sm:px-5">Preview</th>
                <th className="px-4 py-3 sm:px-5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {options.map((opt) => (
                <BookingTypeRow
                  key={opt.code}
                  opt={opt}
                  draft={drafts[opt.code] ?? buildDraftsFromOptions([opt])[opt.code]!}
                  onLabelChange={onLabelChange}
                  onAccentChange={onAccentChange}
                />
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col items-stretch gap-3 border-t border-slate-200 bg-slate-50/60 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-xs text-slate-500">Changes are not saved until you click the button.</p>
          <button
            type="button"
            disabled={pending}
            onClick={saveAll}
            className="rounded-xl bg-[#1e5ea8] px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#17497f] disabled:opacity-50 sm:shrink-0"
          >
            {pending ? "Saving…" : "Save all changes"}
          </button>
        </div>
      </section>
    </div>
  );
}
