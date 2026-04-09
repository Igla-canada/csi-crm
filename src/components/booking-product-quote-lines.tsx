"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { createProductServiceOptionInlineAction } from "@/app/actions";
import { ProductServiceCombobox } from "@/components/product-service-combobox";
import type { ProductServiceResolveRow } from "@/lib/product-service-resolve";
import { cn } from "@/lib/crm-shared";

export type BookingQuoteLine = { product: string; priceText: string };

export type ProductServiceOptionForBooking = {
  code: string;
  label: string;
  matchTerms: string;
  active: boolean;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function isKnownProductValue(trim: string, rows: ProductServiceResolveRow[]): boolean {
  if (!trim) return true;
  return rows.some(
    (o) =>
      o.active &&
      (o.code.toLowerCase() === trim.toLowerCase() || o.label.trim().toLowerCase() === trim.toLowerCase()),
  );
}

type Props = {
  /** Workspace product/service list; defaults to [] if omitted. */
  productOptions?: ProductServiceOptionForBooking[] | null;
  lines: BookingQuoteLine[];
  onLinesChange: (next: BookingQuoteLine[]) => void;
  disabled?: boolean;
  disabledHint?: string;
  compact?: boolean;
  className?: string;
};

export function BookingProductQuoteLines({
  productOptions: productOptionsProp,
  lines,
  onLinesChange,
  disabled = false,
  disabledHint = "Products and quotes are stored on the linked call log.",
  compact = false,
  className,
}: Props) {
  const productOptions = productOptionsProp ?? [];
  const router = useRouter();
  const userEditedProductRef = useRef(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addProductLabel, setAddProductLabel] = useState("");
  const [addProductLineIndex, setAddProductLineIndex] = useState(0);
  const [addProductError, setAddProductError] = useState<string | null>(null);
  const [addProductPending, setAddProductPending] = useState(false);
  const [, startTransition] = useTransition();

  const productResolveRows: ProductServiceResolveRow[] = useMemo(
    () =>
      productOptions.map((o) => ({
        code: o.code,
        label: o.label,
        matchTerms: o.matchTerms,
        active: o.active,
      })),
    [productOptions],
  );

  useEffect(() => {
    const w = window as unknown as { __crmBookingQuoteValidate?: () => boolean };
    w.__crmBookingQuoteValidate = () => {
      for (let i = 0; i < lines.length; i++) {
        const trim = lines[i]!.product.trim();
        if (trim && !isKnownProductValue(trim, productResolveRows)) {
          setAddProductLabel(trim);
          setAddProductLineIndex(i);
          setAddProductError(null);
          setAddProductOpen(true);
          return false;
        }
      }
      return true;
    };
    return () => {
      delete w.__crmBookingQuoteValidate;
    };
  }, [lines, productResolveRows]);

  const labelCls = compact
    ? "mb-1 block text-xs font-medium uppercase tracking-wide text-[#70757a]"
    : "mb-2 block text-xs font-medium uppercase tracking-wide text-[#70757a]";
  const rowPad = compact ? "p-3" : "p-4";
  const inputProductCls = compact
    ? "w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-sm text-[#3c4043] outline-none placeholder:text-slate-400 focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]"
    : "w-full rounded-lg border border-[#dadce0] bg-white px-3 py-2.5 text-sm text-[#3c4043] outline-none placeholder:text-slate-400 focus:border-[#1a73e8] focus:ring-1 focus:ring-[#1a73e8]";

  if (disabled) {
    return (
      <div className={cn("rounded-xl border border-[#dadce0] bg-[#f8f9fa] px-4 py-3 text-sm text-[#5f6368]", className)}>
        {disabledHint}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <p className={labelCls}>Products / services &amp; quotes (optional)</p>
        <p className={compact ? "text-[11px] leading-snug text-[#5f6368]" : "text-xs text-[#5f6368]"}>
          Same as Log a call — add none, one, or several lines. We create a call log for this booking so these show on the
          client timeline.
        </p>
      </div>

      <div className="space-y-3">
        {lines.map((line, i) => (
          <div
            key={i}
            className={cn(
              "grid gap-3 rounded-xl border border-[#dadce0]/90 bg-[#fafafa] md:grid-cols-[1fr_minmax(0,9rem)_auto] md:items-end",
              rowPad,
            )}
          >
            <div>
              <span className={cn(labelCls, "!mb-1.5 !normal-case !tracking-normal text-[#5f6368]")}>
                Product / service{lines.length > 1 ? ` (${i + 1})` : ""}
              </span>
              <ProductServiceCombobox
                value={line.product}
                options={productOptions}
                placeholder="Type to search or pick from list"
                inputClassName={inputProductCls}
                onChange={(v) => {
                  userEditedProductRef.current = true;
                  const next = [...lines];
                  next[i] = { ...next[i]!, product: v, priceText: next[i]!.priceText };
                  onLinesChange(next);
                  if (!v.trim() && lines.length === 1) userEditedProductRef.current = false;
                }}
              />
            </div>
            <div>
              <span className={cn(labelCls, "!mb-1.5 !normal-case !tracking-normal text-[#5f6368]")}>Price / quote</span>
              <div className="relative">
                <span
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-[#5f6368]"
                  aria-hidden
                >
                  $
                </span>
                <input
                  inputMode="numeric"
                  autoComplete="off"
                  value={line.priceText}
                  onChange={(e) => {
                    const next = [...lines];
                    next[i] = {
                      ...next[i]!,
                      product: next[i]!.product,
                      priceText: digitsOnly(e.target.value),
                    };
                    onLinesChange(next);
                  }}
                  placeholder="1199"
                  className={cn(inputProductCls, "pl-7")}
                />
              </div>
            </div>
            <div className="flex md:justify-end">
              {lines.length > 1 ? (
                <button
                  type="button"
                  onClick={() => onLinesChange(lines.filter((_, j) => j !== i))}
                  className="rounded-lg border border-[#dadce0] bg-white px-3 py-2 text-xs font-semibold text-[#3c4043] hover:bg-[#f1f3f4]"
                >
                  Remove
                </button>
              ) : (
                <span className="hidden md:block" aria-hidden />
              )}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => {
            onLinesChange([...lines, { product: "", priceText: "" }]);
            userEditedProductRef.current = true;
          }}
          className="text-sm font-semibold text-[#1a73e8] underline-offset-2 hover:underline"
        >
          + Add another product / quote
        </button>
      </div>

      {addProductOpen ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) {
              setAddProductOpen(false);
              const next = [...lines];
              if (next[addProductLineIndex]) {
                next[addProductLineIndex] = {
                  ...next[addProductLineIndex]!,
                  product: "",
                  priceText: next[addProductLineIndex]!.priceText,
                };
                onLinesChange(next);
              }
              if (lines.length === 1) userEditedProductRef.current = false;
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="booking-add-product-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h2 id="booking-add-product-title" className="text-lg font-semibold text-slate-900">
              Add new product / service?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              &quot;{addProductLabel}&quot; is not in your workspace list yet. Add it for this and future bookings, or cancel
              to clear the field.
            </p>
            {addProductError ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {addProductError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50"
                onClick={() => {
                  setAddProductOpen(false);
                  const next = [...lines];
                  if (next[addProductLineIndex]) {
                    next[addProductLineIndex] = {
                      ...next[addProductLineIndex]!,
                      product: "",
                      priceText: next[addProductLineIndex]!.priceText,
                    };
                    onLinesChange(next);
                  }
                  if (lines.length === 1) userEditedProductRef.current = false;
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addProductPending}
                className="rounded-xl bg-[#1e5ea8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#17497f] disabled:opacity-50"
                onClick={() => {
                  setAddProductPending(true);
                  setAddProductError(null);
                  void (async () => {
                    const res = await createProductServiceOptionInlineAction(addProductLabel);
                    setAddProductPending(false);
                    if (!res.ok) {
                      setAddProductError(res.message);
                      return;
                    }
                    setAddProductOpen(false);
                    const next = [...lines];
                    if (next[addProductLineIndex]) {
                      next[addProductLineIndex] = {
                        ...next[addProductLineIndex]!,
                        product: addProductLabel,
                        priceText: next[addProductLineIndex]!.priceText,
                      };
                      onLinesChange(next);
                    }
                    userEditedProductRef.current = true;
                    startTransition(() => router.refresh());
                  })();
                }}
              >
                {addProductPending ? "Adding…" : "Add to workspace"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function validateBookingQuoteLinesBeforeSubmit(): boolean {
  const w = window as unknown as { __crmBookingQuoteValidate?: () => boolean };
  return w.__crmBookingQuoteValidate ? w.__crmBookingQuoteValidate() : true;
}

export function serializeBookingQuoteLines(lines: BookingQuoteLine[]): string {
  return JSON.stringify(lines.filter((l) => l.product.trim() || l.priceText.trim()));
}
