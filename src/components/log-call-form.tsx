"use client";

import { CallDirection } from "@/lib/db";
import {
  Fragment,
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";

import {
  createCallLogAction,
  createProductServiceOptionInlineAction,
  getClientCallLogPrefillAction,
  lookupClientsByPhoneAction,
} from "@/app/actions";
import type { CreateCallLogActionState } from "@/app/actions";
import {
  buildBookingNotesFromCallLines,
  buildBookingTitleFromCallLines,
  CALL_OUTCOME_BOOKED_CODE,
  writeBookingFromCallToSession,
} from "@/lib/booking-from-call";
import type { ClientPhoneMatch } from "@/lib/crm-types";
import { callResultSelectPresentation } from "@/lib/call-result-accents";
import {
  resolveProductServiceCodeFromHaystack,
  type ProductServiceResolveRow,
} from "@/lib/product-service-resolve";
import { CALL_LOG_PHONE_DIGITS } from "@/lib/call-contact-validation";
import { normalizePhone } from "@/lib/phone";
import { ProductServiceCombobox } from "@/components/product-service-combobox";
import { useRouter } from "next/navigation";

const MIN_DIGITS = 7;

export type CallResultOptionDTO = {
  code: string;
  label: string;
  /** Preset id from `CallResultOption.accentKey` (see `call-result-accents.ts`). */
  accentKey?: string | null;
  /** Optional `#rrggbb` override from `CallResultOption.accentHex`. */
  accentHex?: string | null;
  /** When false, shown only in edit screens for existing calls — not in quick pick / Log a Call. */
  active?: boolean;
};

export type ProductServiceOptionDTO = {
  code: string;
  label: string;
  matchTerms: string;
  active: boolean;
};

export type LeadSourceOptionDTO = {
  code: string;
  label: string;
  active: boolean;
};

export type LiveLogPrefill = {
  phone?: string;
  contactName?: string;
  direction?: CallDirection;
  clientId?: string;
} | null;

type LogCallFormProps = {
  defaultHappenedAt: string;
  callResultOptions: CallResultOptionDTO[];
  productServiceOptions: ProductServiceOptionDTO[];
  leadSourceOptions: LeadSourceOptionDTO[];
  defaultOutcomeCode?: string;
  /** From RingCentral live dock URL (`?liveLog=1&…`). */
  liveLogPrefill?: LiveLogPrefill;
  /** Lock client when logging from a client card (phone may not match primary). */
  fixedClientId?: string;
};

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function formatSavedTime(ts: number) {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function isKnownProductValue(trim: string, rows: ProductServiceResolveRow[]): boolean {
  if (!trim) return true;
  return rows.some(
    (o) =>
      o.active &&
      (o.code.toLowerCase() === trim.toLowerCase() || o.label.trim().toLowerCase() === trim.toLowerCase()),
  );
}

type ProductPriceLine = { product: string; priceText: string };

export function LogCallForm({
  defaultHappenedAt,
  callResultOptions,
  productServiceOptions,
  leadSourceOptions,
  defaultOutcomeCode = "FOLLOW_UP",
  liveLogPrefill = null,
  fixedClientId,
}: LogCallFormProps) {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [matches, setMatches] = useState<ClientPhoneMatch[]>([]);
  const [lookupPending, setLookupPending] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [forceNewClient, setForceNewClient] = useState(false);
  const [prefillPending, setPrefillPending] = useState(false);

  const [contactName, setContactName] = useState("");
  const [vehicleText, setVehicleText] = useState("");
  const [source, setSource] = useState("");

  const [happenedAt, setHappenedAt] = useState(defaultHappenedAt);
  const [direction, setDirection] = useState<CallDirection>(CallDirection.INBOUND);
  const livePrefillAppliedRef = useRef<string>("");
  const visibleResultOptions = useMemo(
    () => callResultOptions.filter((o) => o.active !== false),
    [callResultOptions],
  );
  const visibleLeadSources = useMemo(() => {
    const s = source.trim();
    return leadSourceOptions.filter((o) => o.active !== false || (Boolean(s) && o.code === s));
  }, [leadSourceOptions, source]);
  const firstCode = visibleResultOptions[0]?.code ?? "FOLLOW_UP";
  const [outcomeCode, setOutcomeCode] = useState(() =>
    visibleResultOptions.some((o) => o.code === defaultOutcomeCode) ? defaultOutcomeCode : firstCode,
  );
  const outcomeSelectPresentation = useMemo(() => {
    const opt = visibleResultOptions.find((o) => o.code === outcomeCode);
    return callResultSelectPresentation(opt?.accentHex, opt?.accentKey, outcomeCode, "lg");
  }, [visibleResultOptions, outcomeCode]);
  const productResolveRows: ProductServiceResolveRow[] = useMemo(
    () =>
      productServiceOptions.map((o) => ({
        code: o.code,
        label: o.label,
        matchTerms: o.matchTerms,
        active: o.active,
      })),
    [productServiceOptions],
  );

  const [lines, setLines] = useState<ProductPriceLine[]>([{ product: "", priceText: "" }]);
  const userEditedProductRef = useRef(false);
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [addProductLabel, setAddProductLabel] = useState("");
  const [addProductLineIndex, setAddProductLineIndex] = useState(0);
  const [addProductError, setAddProductError] = useState<string | null>(null);
  const [addProductPending, setAddProductPending] = useState(false);
  const pendingSubmitFormRef = useRef<HTMLFormElement | null>(null);
  const [summary, setSummary] = useState("");
  const [callbackNotes, setCallbackNotes] = useState("");
  const [followUpAt, setFollowUpAt] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  useEffect(() => {
    if (!fixedClientId?.trim()) return;
    setSelectedClientId(fixedClientId.trim());
    setForceNewClient(false);
  }, [fixedClientId]);

  useEffect(() => {
    if (!liveLogPrefill) return;
    const key = JSON.stringify(liveLogPrefill);
    if (livePrefillAppliedRef.current === key) return;
    livePrefillAppliedRef.current = key;

    if (liveLogPrefill.phone?.trim()) setPhone(liveLogPrefill.phone.trim());
    if (liveLogPrefill.contactName?.trim()) setContactName(liveLogPrefill.contactName.trim());
    if (
      liveLogPrefill.direction === CallDirection.INBOUND ||
      liveLogPrefill.direction === CallDirection.OUTBOUND
    ) {
      setDirection(liveLogPrefill.direction);
    }
    if (liveLogPrefill.clientId?.trim()) {
      setSelectedClientId(liveLogPrefill.clientId.trim());
      setForceNewClient(false);
    }
  }, [liveLogPrefill]);

  useEffect(() => {
    if (userEditedProductRef.current || lines.length !== 1) return;
    const haystack = [summary, vehicleText, callbackNotes, internalNotes].filter(Boolean).join(" | ");
    const code = resolveProductServiceCodeFromHaystack("", haystack, productResolveRows);
    if (code === "GENERAL") {
      setLines((prev) => {
        if (prev.length !== 1) return prev;
        if (prev[0]?.product === "") return prev;
        return [{ ...prev[0]!, product: "", priceText: prev[0]!.priceText }];
      });
      return;
    }
    const label =
      productResolveRows.find((o) => o.code === code && o.active)?.label ??
      productResolveRows.find((o) => o.code === code)?.label ??
      code;
    setLines((prev) => {
      if (prev.length !== 1) return prev;
      if (prev[0]?.product === label) return prev;
      return [{ ...prev[0]!, product: label, priceText: prev[0]!.priceText }];
    });
  }, [summary, vehicleText, callbackNotes, internalNotes, productResolveRows, lines.length]);

  const normalizedDigits = useMemo(() => normalizePhone(phone), [phone]);
  const digitsLen = useMemo(() => digitsOnly(phone).length, [phone]);

  const phoneHasMatches = Boolean(
    normalizedDigits && normalizedDigits.length >= MIN_DIGITS && matches.length > 0,
  );

  const runLookup = useCallback(async (raw: string) => {
    const n = normalizePhone(raw);
    if (!n || n.length < MIN_DIGITS) {
      setMatches([]);
      return;
    }
    setLookupPending(true);
    try {
      const found = await lookupClientsByPhoneAction(raw);
      setMatches(found);
    } finally {
      setLookupPending(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void runLookup(phone);
    }, 400);
    return () => clearTimeout(t);
  }, [phone, runLookup]);

  useEffect(() => {
    if (fixedClientId?.trim()) return;
    if (digitsLen < MIN_DIGITS) {
      setMatches([]);
      if (!forceNewClient) {
        setSelectedClientId("");
      }
    }
  }, [digitsLen, forceNewClient, fixedClientId]);

  useEffect(() => {
    if (forceNewClient) {
      setSelectedClientId("");
      return;
    }
    const fid = fixedClientId?.trim();
    if (fid) {
      setSelectedClientId(fid);
      return;
    }
    setSelectedClientId((prev) => (matches.some((m) => m.id === prev) ? prev : ""));
  }, [matches, forceNewClient, fixedClientId]);

  useEffect(() => {
    if (forceNewClient) {
      setContactName("");
      setVehicleText("");
      setSource("");
    }
  }, [forceNewClient]);

  useEffect(() => {
    if (lookupPending || forceNewClient) {
      return;
    }
    if (!normalizedDigits || normalizedDigits.length < MIN_DIGITS) {
      return;
    }
    if (matches.length > 0 && !selectedClientId) {
      setContactName("");
      setVehicleText("");
      setSource("");
    }
  }, [lookupPending, forceNewClient, normalizedDigits, matches.length, selectedClientId]);

  useEffect(() => {
    if (!selectedClientId || forceNewClient) {
      return;
    }

    let cancelled = false;
    setPrefillPending(true);
    void (async () => {
      try {
        const prefill = await getClientCallLogPrefillAction(selectedClientId);
        if (cancelled || !prefill) return;
        setContactName(prefill.displayName);
        setVehicleText(prefill.vehicleText);
        setSource(prefill.source);
      } finally {
        if (!cancelled) {
          setPrefillPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedClientId, forceNewClient]);

  const needsExplicitChoice =
    Boolean(!fixedClientId?.trim() && phoneHasMatches && !forceNewClient && !selectedClientId);

  const [lastSavedCallLogId, setLastSavedCallLogId] = useState("");
  const [lastSavedClientId, setLastSavedClientId] = useState("");
  const [lastSavePhoneNorm, setLastSavePhoneNorm] = useState("");

  const clearDraftCallLog = () => {
    setLastSavedCallLogId("");
    setLastSavedClientId("");
    setLastSavePhoneNorm("");
  };

  const selectExisting = (clientId: string) => {
    if (selectedClientId && selectedClientId !== clientId) {
      clearDraftCallLog();
    }
    setForceNewClient(false);
    setSelectedClientId(clientId);
  };

  const chooseNewCustomer = () => {
    clearDraftCallLog();
    setForceNewClient(true);
    setSelectedClientId("");
  };

  const single = matches.length === 1 ? matches[0] : null;

  const [formState, formAction, savePending] = useActionState<
    CreateCallLogActionState,
    FormData
  >(createCallLogAction, null);

  const [, startTransition] = useTransition();

  const errorBannerRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef(phone);
  phoneRef.current = phone;
  const handledSaveAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (formState?.ok === false) {
      errorBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [formState]);

  const [saveToast, setSaveToast] = useState<{ savedAt: number; open: boolean } | null>(null);

  useEffect(() => {
    if (formState?.ok !== true) return;

    const savedAt = formState.savedAt;
    setSaveToast({ savedAt, open: false });

    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setSaveToast((prev) =>
          prev && prev.savedAt === savedAt ? { ...prev, open: true } : prev,
        );
      });
    });

    const slideDown = window.setTimeout(() => {
      setSaveToast((prev) =>
        prev && prev.savedAt === savedAt ? { ...prev, open: false } : prev,
      );
    }, 5200);

    const remove = window.setTimeout(() => {
      setSaveToast((prev) => (prev && prev.savedAt === savedAt ? null : prev));
    }, 5600);

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      window.clearTimeout(slideDown);
      window.clearTimeout(remove);
    };
  }, [formState]);

  useEffect(() => {
    if (formState?.ok !== true) return;
    if (handledSaveAtRef.current === formState.savedAt) return;
    handledSaveAtRef.current = formState.savedAt;
    setLastSavedCallLogId(formState.callLogId);
    setLastSavedClientId(formState.clientId);
    setLastSavePhoneNorm(normalizePhone(phoneRef.current) ?? "");
  }, [formState]);

  useEffect(() => {
    if (!lastSavedCallLogId || !lastSavePhoneNorm) return;
    if (normalizePhone(phone) !== lastSavePhoneNorm) {
      setLastSavedCallLogId("");
    }
  }, [phone, lastSavedCallLogId, lastSavePhoneNorm]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    const form = e.currentTarget;
    for (let i = 0; i < lines.length; i++) {
      const trim = lines[i]!.product.trim();
      if (trim && !isKnownProductValue(trim, productResolveRows)) {
        e.preventDefault();
        setAddProductLabel(trim);
        setAddProductLineIndex(i);
        setAddProductError(null);
        setAddProductOpen(true);
        pendingSubmitFormRef.current = form;
        return;
      }
    }
    e.preventDefault();
    startTransition(() => {
      formAction(new FormData(form));
    });
  };

  return (
    <Fragment>
    <form onSubmit={handleSubmit} className="mt-6 grid gap-4">
      {formState?.ok === true ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950"
        >
          <p className="font-semibold">Call saved at {formatSavedTime(formState.savedAt)}</p>
          <p className="text-emerald-900/90">
            Your entries stay on this page. If you change something and save again, we update this same call — we do not
            create a duplicate in the timeline.
          </p>
          {formState.ok === true && formState.outcomeCode === CALL_OUTCOME_BOOKED_CODE && formState.clientId ? (
            <button
              type="button"
              onClick={() => {
                writeBookingFromCallToSession({
                  clientId: formState.clientId,
                  clientPhone: phone,
                  clientDisplayName: contactName,
                  vehicleText,
                  title: buildBookingTitleFromCallLines(
                    vehicleText,
                    lines.map((l) => l.product.trim()).filter(Boolean),
                  ),
                  notes: buildBookingNotesFromCallLines({
                    linePrices: lines.map((l) => l.priceText),
                    summary,
                    callbackNotes,
                  }),
                  callLogId: formState.callLogId,
                });
                router.push("/appointments");
              }}
              className="self-start rounded-xl bg-emerald-800 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900"
            >
              Set up booking now
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              clearDraftCallLog();
            }}
            className="self-start text-sm font-semibold text-emerald-900 underline-offset-2 hover:underline"
          >
            Start a new call entry instead
          </button>
        </div>
      ) : null}

      {formState?.ok === false ? (
        <div
          ref={errorBannerRef}
          role="alert"
          className="flex flex-col gap-1 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950"
        >
          <p className="font-semibold">This call was not saved</p>
          <p className="text-red-900/95">{formState.message}</p>
          <p className="text-xs text-red-800/90">
            Fix the issue, then press &quot;Save call log&quot; again. Everything you typed is still in the form.
          </p>
        </div>
      ) : null}

      <input type="hidden" name="clientId" value={selectedClientId || lastSavedClientId} readOnly />
      <input type="hidden" name="callLogId" value={lastSavedCallLogId} readOnly />
      <input type="hidden" name="forceNewClient" value={forceNewClient ? "true" : "false"} readOnly />
      <input type="hidden" name="productQuoteLinesJson" value={JSON.stringify(lines)} readOnly />

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Date and time</label>
          <input
            name="happenedAt"
            type="datetime-local"
            value={happenedAt}
            onChange={(e) => setHappenedAt(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Phone number</label>
          <input
            name="contactPhone"
            inputMode="numeric"
            autoComplete="tel"
            maxLength={CALL_LOG_PHONE_DIGITS}
            value={phone}
            onChange={(e) => {
              setPhone(digitsOnly(e.target.value).slice(0, CALL_LOG_PHONE_DIGITS));
              setForceNewClient(false);
            }}
            placeholder="10-digit number"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          {phone.length > 0 && phone.length < CALL_LOG_PHONE_DIGITS ? (
            <p className="mt-2 text-xs text-slate-500">
              Enter all {CALL_LOG_PHONE_DIGITS} digits, or clear the field if there is no number for this call.
            </p>
          ) : null}
          {lookupPending ? (
            <p className="mt-2 text-xs text-slate-500">Checking for existing customers…</p>
          ) : null}
          {digitsLen >= MIN_DIGITS && matches.length === 0 && !lookupPending ? (
            <p className="mt-2 text-xs text-slate-600">
              No saved customer uses this number yet. This call will start a new customer record.
            </p>
          ) : null}

          {single && !forceNewClient && selectedClientId !== single.id ? (
            <div className="crm-soft-row mt-3 rounded-2xl p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">This number is on file</p>
              <p className="mt-1 text-slate-600">Link this call to the saved customer and fill name, vehicle, and source from their profile.</p>
              <button
                type="button"
                onClick={() => selectExisting(single.id)}
                className="mt-3 w-full rounded-2xl bg-[#1e5ea8] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17497f]"
              >
                Use {single.displayName} — load profile
              </button>
              <button
                type="button"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                onClick={chooseNewCustomer}
              >
                New customer — same phone number
              </button>
            </div>
          ) : null}

          {single && !forceNewClient && selectedClientId === single.id && prefillPending ? (
            <p className="mt-2 text-xs text-slate-500">Loading profile…</p>
          ) : null}

          {matches.length > 1 && !forceNewClient && !selectedClientId ? (
            <div className="crm-soft-row mt-3 rounded-2xl p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Several customers share this number</p>
              <p className="mt-1 text-slate-600">Pick who this call is for — we will load their profile into the form.</p>
              <ul className="mt-3 space-y-2">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => selectExisting(m.id)}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-sm text-slate-800 transition hover:border-slate-300"
                    >
                      {m.displayName}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-3 text-sm font-semibold text-[#1e5ea8] underline-offset-2 hover:underline"
                onClick={chooseNewCustomer}
              >
                New customer — same phone number
              </button>
              {needsExplicitChoice ? (
                <p className="mt-3 text-xs font-medium text-amber-800">
                  Choose a customer or &quot;new customer&quot; before saving.
                </p>
              ) : null}
            </div>
          ) : null}

          {matches.length > 1 && !forceNewClient && selectedClientId && prefillPending ? (
            <p className="mt-2 text-xs text-slate-500">Loading profile…</p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Customer</label>
          <input
            name="contactName"
            value={contactName}
            onChange={(e) => setContactName(e.target.value.replace(/\d/g, ""))}
            placeholder="Customer name"
            autoComplete="name"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Vehicle</label>
          <input
            name="vehicleText"
            value={vehicleText}
            onChange={(e) => setVehicleText(e.target.value)}
            placeholder="Year / make / model"
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
        </div>

        <div className="md:col-span-2">
          <div className="space-y-4">
            {lines.map((line, i) => (
              <div
                key={i}
                className="grid gap-4 rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4 md:grid-cols-[1fr_minmax(0,10rem)_auto] md:items-end"
              >
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Product / service{i > 0 ? ` (${i + 1})` : ""}
                  </label>
                  <ProductServiceCombobox
                    value={line.product}
                    options={productServiceOptions}
                    placeholder="Start typing — pick a suggestion or add a new one when you save"
                    inputClassName="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1e5ea8]/35 focus:ring-2 focus:ring-[#1e5ea8]/15"
                    onChange={(v) => {
                      userEditedProductRef.current = true;
                      setLines((prev) => {
                        const next = [...prev];
                        next[i] = { ...next[i]!, product: v, priceText: next[i]!.priceText };
                        return next;
                      });
                      if (!v.trim() && lines.length === 1) {
                        userEditedProductRef.current = false;
                      }
                    }}
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">Price / quote</label>
                  <div className="relative">
                    <span
                      className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-600"
                      aria-hidden
                    >
                      $
                    </span>
                    <input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="off"
                      value={line.priceText}
                      onChange={(e) =>
                        setLines((prev) => {
                          const next = [...prev];
                          next[i] = {
                            ...next[i]!,
                            product: next[i]!.product,
                            priceText: digitsOnly(e.target.value),
                          };
                          return next;
                        })
                      }
                      placeholder="1199"
                      className="w-full rounded-2xl border border-slate-200 bg-white py-3 pl-8 pr-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>
                <div className="flex md:justify-end">
                  {lines.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
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
                setLines((p) => [...p, { product: "", priceText: "" }]);
                userEditedProductRef.current = true;
              }}
              className="text-sm font-semibold text-[#1e5ea8] underline-offset-2 hover:underline"
            >
              + Add another product / quote
            </button>
            <p className="text-xs text-slate-500">
              Each row is one item quoted on this call (e.g. dash cam and IGLA). Leave products blank to auto-detect from
              the summary and vehicle. If you type a new name, we ask before saving so you can add it under{" "}
              <a href="/settings?tab=products" className="font-medium text-[#1e5ea8] hover:underline">
                Workspace → Products / services
              </a>
              .
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Direction</label>
          <select
            name="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as CallDirection)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
          >
            {Object.values(CallDirection).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Call result</label>
          <select
            name="outcomeCode"
            value={outcomeCode}
            onChange={(e) => setOutcomeCode(e.target.value)}
            className={outcomeSelectPresentation.className}
            style={outcomeSelectPresentation.style}
          >
            {visibleResultOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
          {outcomeCode === CALL_OUTCOME_BOOKED_CODE ? (
            <p className="mt-2 text-xs text-slate-600">
              After you save, you can open <span className="font-medium text-slate-800">Bookings</span> with customer,
              vehicle, and quote carried into a new appointment.
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className="mb-2 block text-sm font-medium text-slate-700">Found us through</label>
          <select
            name="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
          >
            <option value="">— Not set —</option>
            {visibleLeadSources.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-slate-500">
            Manage options under{" "}
            <a href="/settings?tab=lead-sources" className="font-medium text-[#1e5ea8] hover:underline">
              Workspace → Lead sources
            </a>
            .
          </p>
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Call summary</label>
        <textarea
          name="summary"
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Example: Customer asked about dash cam install for 2022 BMW and was quoted pricing."
          className="min-h-32 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Callback notes</label>
        <textarea
          name="callbackNotes"
          value={callbackNotes}
          onChange={(e) => setCallbackNotes(e.target.value)}
          placeholder="What should happen next and when to call back"
          className="min-h-24 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Follow-up time</label>
        <input
          name="followUpAt"
          type="datetime-local"
          value={followUpAt}
          onChange={(e) => setFollowUpAt(e.target.value)}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium text-slate-700">Private staff notes</label>
        <textarea
          name="internalNotes"
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          placeholder="Anything internal the team should remember."
          className="min-h-28 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
        />
      </div>

      <button
        type="submit"
        disabled={needsExplicitChoice || savePending}
        className="rounded-2xl bg-[#1e5ea8] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#17497f] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {savePending ? "Saving…" : "Save call log"}
      </button>
    </form>

      {addProductOpen ? (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/40 p-4"
          role="presentation"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) {
              setAddProductOpen(false);
              setLines((prev) => {
                const next = [...prev];
                if (next[addProductLineIndex]) {
                  next[addProductLineIndex] = {
                    ...next[addProductLineIndex]!,
                    product: "",
                    priceText: next[addProductLineIndex]!.priceText,
                  };
                }
                if (next.length === 1) userEditedProductRef.current = false;
                return next;
              });
              pendingSubmitFormRef.current = null;
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-product-title"
            className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h2 id="add-product-title" className="text-lg font-semibold text-slate-900">
              Add new product / service?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              &quot;{addProductLabel}&quot; is not in your workspace list yet. Add it so this and future calls can use it,
              or cancel to clear the field.
            </p>
            {addProductError ? (
              <p className="mt-3 text-sm text-red-700" role="alert">
                {addProductError}
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50"
                onClick={() => {
                  setAddProductOpen(false);
                  setLines((prev) => {
                    const next = [...prev];
                    if (next[addProductLineIndex]) {
                      next[addProductLineIndex] = {
                        ...next[addProductLineIndex]!,
                        product: "",
                        priceText: next[addProductLineIndex]!.priceText,
                      };
                    }
                    if (next.length === 1) userEditedProductRef.current = false;
                    return next;
                  });
                  pendingSubmitFormRef.current = null;
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={addProductPending}
                className="rounded-xl bg-[#1e5ea8] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17497f] disabled:opacity-50"
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
                    setLines((prev) => {
                      const next = [...prev];
                      if (next[addProductLineIndex]) {
                        next[addProductLineIndex] = {
                          ...next[addProductLineIndex]!,
                          product: addProductLabel,
                          priceText: next[addProductLineIndex]!.priceText,
                        };
                      }
                      return next;
                    });
                    userEditedProductRef.current = true;
                    router.refresh();
                    const pendingForm = pendingSubmitFormRef.current;
                    pendingSubmitFormRef.current = null;
                    if (pendingForm) {
                      startTransition(() => {
                        formAction(new FormData(pendingForm));
                      });
                    }
                  })();
                }}
              >
                {addProductPending ? "Adding…" : "Add and save call"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saveToast ? (
        <div
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[200] flex justify-center px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
          aria-live="polite"
        >
          <div
            role="status"
            className={`pointer-events-auto w-full max-w-lg origin-bottom overflow-hidden rounded-t-2xl border border-emerald-500/40 bg-emerald-700 text-white shadow-[0_-8px_32px_rgba(5,80,50,0.35)] transition-all duration-300 ease-out ${
              saveToast.open ? "translate-y-0 opacity-100" : "translate-y-[110%] opacity-0"
            }`}
          >
            <div className="h-1 w-full bg-gradient-to-r from-emerald-300 via-white/90 to-emerald-300" />
            <div className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/15 text-lg font-bold"
                aria-hidden
              >
                ✓
              </span>
              <div className="min-w-0 flex-1 text-sm leading-snug">
                <p className="font-semibold tracking-tight">Call saved successfully</p>
                <p className="mt-0.5 text-emerald-100/95">
                  Saved at {formatSavedTime(saveToast.savedAt)}. Save again to update this same call, or use &quot;Start a
                  new call entry&quot; for another line in history.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </Fragment>
  );
}
