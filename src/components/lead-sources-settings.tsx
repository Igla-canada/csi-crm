"use client";

import {
  createLeadSourceOptionAction,
  removeLeadSourceOptionAction,
  saveAllLeadSourceOptionsAction,
  setLeadSourceOptionActiveAction,
  type LeadSourceOptionSaveRow,
} from "@/app/actions";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

export type LeadSourceOptionRow = {
  code: string;
  label: string;
  isBuiltIn: boolean;
  active: boolean;
};

type RowDraft = {
  label: string;
};

type LeadSourcesSettingsProps = {
  options: LeadSourceOptionRow[];
};

function buildDrafts(opts: LeadSourceOptionRow[]): Record<string, RowDraft> {
  return Object.fromEntries(
    opts.map((o) => [
      o.code,
      {
        label: o.label,
      } satisfies RowDraft,
    ]),
  );
}

export function LeadSourcesSettings({ options }: LeadSourcesSettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => buildDrafts(options));

  const onLabelChange = useCallback((code: string, label: string) => {
    setDrafts((d) => (d[code] ? { ...d, [code]: { ...d[code], label } } : d));
  }, []);

  const saveAll = useCallback(() => {
    setSaveError(null);
    const rows: LeadSourceOptionSaveRow[] = options.map((o) => {
      const d = drafts[o.code];
      return {
        code: o.code,
        label: d?.label ?? o.label,
      };
    });
    startTransition(async () => {
      const err = await saveAllLeadSourceOptionsAction(rows);
      if (err?.ok === false) {
        setSaveError(err.message);
        return;
      }
      router.refresh();
    });
  }, [drafts, options, router]);

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600">
        These options appear in the <span className="font-medium text-slate-800">Found us through</span> dropdown on Log
        a Call and when editing a call on a client profile. Rename, hide from new calls, or add custom entries; unused
        custom entries can be removed (otherwise they are hidden if still referenced).
      </p>

      <section className="rounded-[22px] border border-slate-200/90 bg-slate-50/40 p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-slate-800">Add lead source</h4>
        <p className="mt-1 text-xs text-slate-500">Creates a new option immediately.</p>
        <form action={createLeadSourceOptionAction} className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="new-lead-source-label" className="mb-1 block text-xs font-medium text-slate-600">
              Label
            </label>
            <input
              id="new-lead-source-label"
              name="label"
              type="text"
              required
              minLength={2}
              placeholder="e.g. Local radio"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <button
            type="submit"
            className="h-[42px] shrink-0 rounded-xl bg-[#1e5ea8] px-5 text-sm font-semibold text-white transition hover:bg-[#17497f]"
          >
            Add
          </button>
        </form>
      </section>

      <section className="overflow-x-auto rounded-[22px] border border-slate-200/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 sm:px-5">Label</th>
              <th className="px-4 py-3 sm:px-5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {options.map((opt) => {
              const d = drafts[opt.code] ?? { label: opt.label };
              return (
                <tr key={opt.code} className="border-b border-slate-100 align-top last:border-b-0">
                  <td className="px-4 py-4 sm:px-5">
                    <input
                      type="text"
                      value={d.label}
                      onChange={(e) => onLabelChange(opt.code, e.target.value)}
                      minLength={2}
                      required
                      className="w-full min-w-[8rem] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                    <p className="mt-1 text-xs text-slate-400">Code: {opt.code}</p>
                  </td>
                  <td className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap gap-2">
                      <form action={setLeadSourceOptionActiveAction} className="inline">
                        <input type="hidden" name="code" value={opt.code} />
                        <input type="hidden" name="active" value={opt.active ? "false" : "true"} />
                        <button
                          type="submit"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50"
                        >
                          {opt.active ? "Hide" : "Show"}
                        </button>
                      </form>
                      {opt.isBuiltIn ? (
                        <span className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-400">
                          Built-in
                        </span>
                      ) : (
                        <form action={removeLeadSourceOptionAction} className="inline">
                          <input type="hidden" name="code" value={opt.code} />
                          <button
                            type="submit"
                            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-900 transition hover:bg-red-100"
                          >
                            Delete
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {saveError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900" role="alert">
          {saveError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={saveAll}
          className="rounded-xl bg-[#1e5ea8] px-6 py-3 text-sm font-semibold text-white transition hover:bg-[#17497f] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save label changes"}
        </button>
      </div>
    </div>
  );
}
