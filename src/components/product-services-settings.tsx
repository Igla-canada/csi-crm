"use client";

import {
  createProductServiceOptionAction,
  removeProductServiceOptionAction,
  saveAllProductServiceOptionsAction,
  setProductServiceOptionActiveAction,
  type ProductServiceOptionSaveRow,
} from "@/app/actions";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";

export type ProductServiceOptionRow = {
  code: string;
  label: string;
  matchTerms: string;
  isBuiltIn: boolean;
  active: boolean;
};

type RowDraft = {
  label: string;
  matchTerms: string;
};

type ProductServicesSettingsProps = {
  options: ProductServiceOptionRow[];
};

function buildDrafts(opts: ProductServiceOptionRow[]): Record<string, RowDraft> {
  return Object.fromEntries(
    opts.map((o) => [
      o.code,
      {
        label: o.label,
        matchTerms: o.matchTerms ?? "",
      } satisfies RowDraft,
    ]),
  );
}

export function ProductServicesSettings({ options }: ProductServicesSettingsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>(() => buildDrafts(options));

  const onLabelChange = useCallback((code: string, label: string) => {
    setDrafts((d) => (d[code] ? { ...d, [code]: { ...d[code], label } } : d));
  }, []);

  const onTermsChange = useCallback((code: string, matchTerms: string) => {
    setDrafts((d) => (d[code] ? { ...d, [code]: { ...d[code], matchTerms } } : d));
  }, []);

  const saveAll = useCallback(() => {
    setSaveError(null);
    const rows: ProductServiceOptionSaveRow[] = options.map((o) => {
      const d = drafts[o.code];
      return {
        code: o.code,
        label: d?.label ?? o.label,
        matchTerms: d?.matchTerms ?? o.matchTerms ?? "",
      };
    });
    startTransition(async () => {
      const err = await saveAllProductServiceOptionsAction(rows);
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
        These names are what staff pick from (with typing suggestions) on Log a Call.{" "}
        <span className="font-medium text-slate-800">Match terms</span> are comma-separated words or phrases we scan in
        the call summary, vehicle, and notes when the product field is left empty — first longest match wins, otherwise{" "}
        <span className="font-medium text-slate-800">General</span> is used.
      </p>

      <section className="rounded-[22px] border border-slate-200/90 bg-slate-50/40 p-4 sm:p-5">
        <h4 className="text-sm font-semibold text-slate-800">Add product / service</h4>
        <p className="mt-1 text-xs text-slate-500">Creates a new entry immediately. Match terms default to the label.</p>
        <form
          action={createProductServiceOptionAction}
          className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        >
          <div className="min-w-0">
            <label htmlFor="new-product-label" className="mb-1 block text-xs font-medium text-slate-600">
              Label
            </label>
            <input
              id="new-product-label"
              name="label"
              type="text"
              required
              minLength={2}
              placeholder="e.g. Remote start"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <div className="min-w-0">
            <label htmlFor="new-product-terms" className="mb-1 block text-xs font-medium text-slate-600">
              Match terms (optional)
            </label>
            <input
              id="new-product-terms"
              name="matchTerms"
              type="text"
              placeholder="remote start, compustar"
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <button
            type="submit"
            className="h-[42px] rounded-xl bg-[#1e5ea8] px-5 text-sm font-semibold text-white transition hover:bg-[#17497f] sm:self-end"
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
              <th className="px-4 py-3 sm:px-5">Match terms</th>
              <th className="px-4 py-3 sm:px-5">Actions</th>
            </tr>
          </thead>
          <tbody>
            {options.map((opt) => {
              const d = drafts[opt.code] ?? { label: opt.label, matchTerms: opt.matchTerms ?? "" };
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
                  </td>
                  <td className="px-4 py-4 sm:px-5">
                    <textarea
                      value={d.matchTerms}
                      onChange={(e) => onTermsChange(opt.code, e.target.value)}
                      rows={2}
                      placeholder="keyword, another phrase"
                      className="w-full min-w-[12rem] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                    />
                  </td>
                  <td className="px-4 py-4 sm:px-5">
                    <div className="flex flex-wrap gap-2">
                      <form action={setProductServiceOptionActiveAction} className="inline">
                        <input type="hidden" name="code" value={opt.code} />
                        <input type="hidden" name="active" value={opt.active ? "false" : "true"} />
                        <button
                          type="submit"
                          disabled={opt.code === "GENERAL" && opt.active}
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {opt.active ? "Hide" : "Show"}
                        </button>
                      </form>
                      {opt.isBuiltIn ? (
                        <span className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-400">
                          Built-in
                        </span>
                      ) : (
                        <form action={removeProductServiceOptionAction} className="inline">
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
          {pending ? "Saving…" : "Save label & match changes"}
        </button>
      </div>
    </div>
  );
}
