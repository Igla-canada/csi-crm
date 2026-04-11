"use client";

import { CallDirection } from "@/lib/db";
import { Pencil } from "lucide-react";
import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { quickUpdateCallResultAction, updateCallLogAction } from "@/app/actions";
import type { QuickCallResultActionState, UpdateCallLogActionState } from "@/app/actions";

import type { CallResultOptionDTO, LeadSourceOptionDTO, ProductServiceOptionDTO } from "@/components/log-call-form";
import { ProductServiceCombobox } from "@/components/product-service-combobox";
import {
  buildBookingNotesFromCallLines,
  buildBookingTitleFromCallLines,
  CALL_OUTCOME_BOOKED_CODE,
  writeBookingFromCallToSession,
} from "@/lib/booking-from-call";
import type { TelephonyGeminiInsights } from "@/lib/telephony-gemini-insights";

const CALLBACK_NEEDED_OUTCOME_CODE = "CALLBACK_NEEDED";
import {
  callResultBadgePresentation,
  resolveCallResultDisplayHex,
} from "@/lib/call-result-accents";

export type CallLogCardSnapshot = {
  id: string;
  happenedAtIso: string;
  followUpAtIso: string | null;
  happenedAtLabel: string;
  followUpAtLabel: string | null;
  loggedByName: string;
  direction: CallDirection;
  outcomeCode: string;
  outcomeLabel: string;
  /** Normalized `#rrggbb` or null (use preset from stored key). */
  outcomeAccentHex: string | null;
  outcomeStoredAccentKey: string | null;
  summary: string;
  contactPhone: string;
  contactName: string;
  vehicleText: string;
  product: string;
  /** Friendly label when `product` is a configured service code. */
  productDisplay: string;
  /** Raw value from DB for display (may include legacy text). */
  priceText: string | null;
  priceDigits: string;
  /** Stored code or legacy free text. */
  source: string;
  /** Display label when `source` is a configured code. */
  sourceDisplay: string;
  callbackNotes: string;
  internalNotes: string;
  /** Product/quote rows (empty when none on file). */
  productQuoteLines: Array<{
    productDisplay: string;
    priceText: string | null;
    priceDigits: string;
  }>;
  /** RingCentral (or other telephony) draft stub — staff should complete fields. */
  telephonyDraft?: boolean;
  hasTelephonyRecording?: boolean;
  /** How many distinct recording files to play (hold/transfer segments). */
  telephonyRecordingSegmentCount?: number;
  telephonyTranscript?: string | null;
  telephonyAiSummary?: string | null;
  /** Async AI job in flight (transcript not yet stored). */
  telephonyAiPending?: boolean;
  /** Parsed Gemini JSON (details, score, notes) when transcribed via CRM. */
  telephonyGeminiStructured?: TelephonyGeminiInsights | null;
  /** Carrier disposition from RingCentral (e.g. Voicemail, Missed). */
  telephonyResult?: string | null;
  /** Listed on Tasks until staff saves the call or changes result. */
  telephonyCallbackPending?: boolean;
};

function digitsOnly(raw: string) {
  return raw.replace(/\D/g, "");
}

function isoToLocalDatetimeInput(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function formatQuoteDisplay(value: string) {
  const t = value?.trim();
  if (!t) return "—";
  if (/^\d+$/.test(t)) return `$${t}`;
  return t;
}

function fieldOrDash(value: string) {
  const t = value?.trim();
  return t ? t : "—";
}

const PLAYBACK_RATES = [1, 1.5, 2] as const;

function TelephonyGeminiInsightsBlock({ insights }: { insights: TelephonyGeminiInsights }) {
  const d = insights.callLogDetails;
  const score = insights.callScore;

  const scoreLine = (label: string, part?: { score?: string; rationale?: string } | null) => {
    if (!part?.score?.trim() && !part?.rationale?.trim()) return null;
    return (
      <div className="mt-2 text-sm">
        <p className="font-semibold text-slate-900">
          {label}
          {part?.score?.trim() ? <span className="font-normal text-slate-600"> — {part.score.trim()}</span> : null}
        </p>
        {part?.rationale?.trim() ? (
          <p className="mt-1 leading-relaxed text-slate-700">{part.rationale.trim()}</p>
        ) : null}
      </div>
    );
  };

  return (
    <div className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/35 px-3 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-900/90">AI call insights (Gemini)</p>

      {d ? (
        <div className="mt-3">
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">Call Log Details</p>
          <dl className="mt-2 grid gap-1.5 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
            <dt className="text-slate-500">Date and time</dt>
            <dd className="text-slate-900">{fieldOrDash(d.dateAndTime ?? "")}</dd>
            <dt className="text-slate-500">Vehicle</dt>
            <dd className="text-slate-900">{fieldOrDash(d.vehicle ?? "")}</dd>
            <dt className="text-slate-500">Product / service</dt>
            <dd className="text-slate-900">{fieldOrDash(d.productOrService ?? "")}</dd>
            <dt className="text-slate-500">Price / quote</dt>
            <dd className="text-slate-900">{fieldOrDash(d.priceOrQuote ?? "")}</dd>
            <dt className="text-slate-500">Direction</dt>
            <dd className="text-slate-900">{fieldOrDash(d.direction ?? "")}</dd>
            <dt className="text-slate-500">Call result</dt>
            <dd className="text-slate-900">{fieldOrDash(d.callResult ?? "")}</dd>
          </dl>
        </div>
      ) : null}

      {insights.callSummary?.trim() ? (
        <div className="mt-4 border-t border-emerald-200/80 pt-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">Call Summary</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{insights.callSummary.trim()}</p>
        </div>
      ) : null}

      {insights.callbackNotes?.trim() ? (
        <div className="mt-4 border-t border-emerald-200/80 pt-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">Callback Notes</p>
          <p className="mt-2 text-sm leading-relaxed text-slate-800">{insights.callbackNotes.trim()}</p>
        </div>
      ) : null}

      {score && (score.overall?.trim() || score.efficiency || score.clarity || score.customerExperience) ? (
        <div className="mt-4 border-t border-emerald-200/80 pt-4">
          <p className="text-[0.65rem] font-bold uppercase tracking-wide text-slate-500">Call Score</p>
          {score.overall?.trim() ? (
            <p className="mt-2 text-sm font-semibold text-slate-900">{score.overall.trim()}</p>
          ) : null}
          {scoreLine("Efficiency", score.efficiency)}
          {scoreLine("Clarity", score.clarity)}
          {scoreLine("Customer experience", score.customerExperience)}
        </div>
      ) : null}
    </div>
  );
}

function TelephonyRecordingPlayer({
  callLogId,
  recordingIndex = 0,
}: {
  callLogId: string;
  recordingIndex?: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);

  const src =
    recordingIndex > 0
      ? `/api/ringcentral/recording?callLogId=${encodeURIComponent(callLogId)}&recordingIndex=${recordingIndex}`
      : `/api/ringcentral/recording?callLogId=${encodeURIComponent(callLogId)}`;

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate]);

  const applyRate = (rate: number) => {
    setPlaybackRate(rate);
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  };

  const speedBtnClass = (active: boolean) =>
    `rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
      active
        ? "bg-[#1e5ea8] text-white ring-1 ring-[#1e5ea8]/40"
        : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    }`;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Speed</span>
        {PLAYBACK_RATES.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => applyRate(r)}
            className={speedBtnClass(playbackRate === r)}
            title={`Play at ${r}× speed`}
          >
            {r === 1 ? "1×" : `${r}×`}
          </button>
        ))}
      </div>
      <audio
        key={src}
        ref={audioRef}
        controls
        preload="metadata"
        className="h-9 w-full max-w-md"
        src={src}
        onLoadedMetadata={(e) => {
          e.currentTarget.playbackRate = playbackRate;
        }}
      >
        Your browser does not support audio playback.
      </audio>
    </div>
  );
}

type CallLogEditFormProps = {
  clientId: string;
  snapshot: CallLogCardSnapshot;
  resultOptions: CallResultOptionDTO[];
  productServiceOptions: ProductServiceOptionDTO[];
  leadSourceOptions: LeadSourceOptionDTO[];
  onCancel: () => void;
  onSaved: (outcomeCode: string) => void;
};

function leadSourceRowsForEdit(
  opts: LeadSourceOptionDTO[],
  storedRaw: string,
): LeadSourceOptionDTO[] {
  const base = opts.filter((o) => o.active !== false || o.code === storedRaw);
  if (storedRaw.trim() && !opts.some((o) => o.code === storedRaw)) {
    return [...base, { code: storedRaw, label: `${storedRaw} (saved text)`, active: true }];
  }
  return base;
}

function CallLogEditForm({
  clientId,
  snapshot,
  resultOptions,
  productServiceOptions,
  leadSourceOptions,
  onCancel,
  onSaved,
}: CallLogEditFormProps) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<UpdateCallLogActionState, FormData>(
    updateCallLogAction,
    null,
  );
  const [, startTransition] = useTransition();

  const [happenedAt, setHappenedAt] = useState(() => isoToLocalDatetimeInput(snapshot.happenedAtIso));
  const [followUpAt, setFollowUpAt] = useState(
    () => (snapshot.followUpAtIso ? isoToLocalDatetimeInput(snapshot.followUpAtIso) : ""),
  );
  const [direction, setDirection] = useState(snapshot.direction);
  const [outcomeCode, setOutcomeCode] = useState(snapshot.outcomeCode);
  const [summary, setSummary] = useState(snapshot.summary);
  const [contactPhone, setContactPhone] = useState(snapshot.contactPhone);
  const [contactName, setContactName] = useState(snapshot.contactName);
  const [vehicleText, setVehicleText] = useState(snapshot.vehicleText);
  const [lines, setLines] = useState(() =>
    snapshot.productQuoteLines.length
      ? snapshot.productQuoteLines.map((l) => ({
          product: l.productDisplay,
          priceDigits: l.priceDigits,
        }))
      : [{ product: snapshot.productDisplay || snapshot.product, priceDigits: snapshot.priceDigits }],
  );
  const [source, setSource] = useState(snapshot.source);
  const [callbackNotes, setCallbackNotes] = useState(snapshot.callbackNotes);
  const [internalNotes, setInternalNotes] = useState(snapshot.internalNotes);

  const leadSourceSelectOptions = useMemo(
    () => leadSourceRowsForEdit(leadSourceOptions, snapshot.source),
    [leadSourceOptions, snapshot.source],
  );

  useEffect(() => {
    if (state?.ok === true) {
      onSaved(state.outcomeCode);
      router.refresh();
    }
  }, [state, onSaved, router]);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    startTransition(() => {
      formAction(new FormData(form));
    });
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-slate-200 bg-slate-50/80 px-4 py-4">
      <input type="hidden" name="callLogId" value={snapshot.id} readOnly />
      <input type="hidden" name="clientId" value={clientId} readOnly />
      <input
        type="hidden"
        name="productQuoteLinesJson"
        value={JSON.stringify(
          lines.map((l) => ({ product: l.product, priceText: l.priceDigits })),
        )}
        readOnly
      />

      {state?.ok === false ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-950"
        >
          {state.message}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Call date & time</label>
          <input
            name="happenedAt"
            type="datetime-local"
            value={happenedAt}
            onChange={(e) => setHappenedAt(e.target.value)}
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Direction</label>
          <select
            name="direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as CallDirection)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            {Object.values(CallDirection).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Call result</label>
          <select
            name="outcomeCode"
            value={outcomeCode}
            onChange={(e) => setOutcomeCode(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            {resultOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
                {opt.active === false ? " (hidden from new calls)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Phone on this call</label>
          <input
            name="contactPhone"
            inputMode="numeric"
            maxLength={10}
            value={contactPhone}
            onChange={(e) => setContactPhone(digitsOnly(e.target.value).slice(0, 10))}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Name on this call</label>
          <input
            name="contactName"
            value={contactName}
            onChange={(e) => setContactName(e.target.value.replace(/\d/g, ""))}
            required
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Vehicle</label>
          <input
            name="vehicleText"
            value={vehicleText}
            onChange={(e) => setVehicleText(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="sm:col-span-2 space-y-3">
          {lines.map((line, i) => (
            <div
              key={i}
              className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_minmax(0,7rem)_auto] sm:items-end"
            >
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Product / service{i > 0 ? ` (${i + 1})` : ""}
                </label>
                <ProductServiceCombobox
                  value={line.product}
                  options={productServiceOptions}
                  inputClassName="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-[#1e5ea8]/35 focus:ring-2 focus:ring-[#1e5ea8]/15"
                  onChange={(v) =>
                    setLines((prev) => {
                      const next = [...prev];
                      next[i] = { ...next[i]!, product: v, priceDigits: next[i]!.priceDigits };
                      return next;
                    })
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Price</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-600">
                    $
                  </span>
                  <input
                    inputMode="numeric"
                    value={line.priceDigits}
                    onChange={(e) =>
                      setLines((prev) => {
                        const next = [...prev];
                        next[i] = {
                          ...next[i]!,
                          product: next[i]!.product,
                          priceDigits: digitsOnly(e.target.value),
                        };
                        return next;
                      })
                    }
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-7 pr-3 text-sm outline-none"
                  />
                </div>
              </div>
              <div className="flex sm:justify-end">
                {lines.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)))}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-semibold text-slate-700"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setLines((p) => [...p, { product: "", priceDigits: "" }])}
            className="text-xs font-semibold text-[#1e5ea8] underline-offset-2 hover:underline"
          >
            + Add product / quote
          </button>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Found us through</label>
          <select
            name="source"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          >
            <option value="">— Not set —</option>
            {leadSourceSelectOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.label}
                {opt.active === false ? " (hidden from new calls)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Summary</label>
          <textarea
            name="summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            required
            rows={3}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Callback notes</label>
          <textarea
            name="callbackNotes"
            value={callbackNotes}
            onChange={(e) => setCallbackNotes(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Follow-up time <span className="font-normal text-slate-400">(clear to remove)</span>
          </label>
          <input
            name="followUpAt"
            type="datetime-local"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1 block text-xs font-medium text-slate-600">Staff only</label>
          <textarea
            name="internalNotes"
            value={internalNotes}
            onChange={(e) => setInternalNotes(e.target.value)}
            rows={2}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-xl bg-[#1e5ea8] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#17497f] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

type CallLogTimelineCardProps = {
  clientId: string;
  showPhoneRow: boolean;
  showNameRow: boolean;
  snapshot: CallLogCardSnapshot;
  /** CRM booking linked to this call (when staff completed “Set up booking” from this log). */
  linkedAppointment?: { id: string; title: string; startAtLabel: string } | null;
  /** When set, shows a reconciliation tag (deposit/payment logged for this call or linked booking). */
  paymentBadgeLabel?: string | null;
  /** All workspace options (active + inactive); used for edit and quick-change when current value is inactive. */
  resultOptions: CallResultOptionDTO[];
  productServiceOptions: ProductServiceOptionDTO[];
  leadSourceOptions: LeadSourceOptionDTO[];
  /** When true, show “Request AI transcript” for RingCentral recordings without a transcript yet. */
  canRequestTranscription?: boolean;
  /** Deep link from Call history — start in edit mode for this card. */
  initialEditOpen?: boolean;
};

export function CallLogTimelineCard({
  clientId,
  showPhoneRow,
  showNameRow,
  snapshot,
  linkedAppointment = null,
  paymentBadgeLabel = null,
  resultOptions,
  productServiceOptions,
  leadSourceOptions,
  canRequestTranscription = false,
  initialEditOpen = false,
}: CallLogTimelineCardProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(() => Boolean(initialEditOpen));
  const [editNonce, setEditNonce] = useState(0);
  const [bookBanner, setBookBanner] = useState(false);
  const [transcribePending, setTranscribePending] = useState(false);
  const [transcribeNote, setTranscribeNote] = useState<string | null>(null);
  const [quickState, quickAction, quickPending] = useActionState<QuickCallResultActionState, FormData>(
    quickUpdateCallResultAction,
    null,
  );
  const [, startQuick] = useTransition();

  useEffect(() => {
    if (initialEditOpen) {
      setEditing(true);
    }
  }, [initialEditOpen, snapshot.id]);

  useEffect(() => {
    if (quickState?.ok === true) {
      if (quickState.outcomeCode === CALL_OUTCOME_BOOKED_CODE) {
        setBookBanner(true);
      }
      router.refresh();
    }
  }, [quickState, router]);

  useEffect(() => {
    if (snapshot.outcomeCode !== CALL_OUTCOME_BOOKED_CODE) {
      setBookBanner(false);
    }
  }, [snapshot.outcomeCode]);

  const quickSelectOptions = useMemo(() => {
    return resultOptions.filter((o) => o.active !== false || o.code === snapshot.outcomeCode);
  }, [resultOptions, snapshot.outcomeCode]);

  const hasFollowUp = Boolean(snapshot.followUpAtIso);
  const statusHex = resolveCallResultDisplayHex(
    snapshot.outcomeAccentHex,
    snapshot.outcomeStoredAccentKey,
    snapshot.outcomeCode,
  );

  const viewBadge = useMemo(
    () =>
      callResultBadgePresentation(
        snapshot.outcomeAccentHex,
        snapshot.outcomeStoredAccentKey,
        snapshot.outcomeCode,
      ),
    [snapshot.outcomeAccentHex, snapshot.outcomeStoredAccentKey, snapshot.outcomeCode],
  );

  return (
    <li id={`call-log-${snapshot.id}`} className="relative scroll-mt-24 pl-10">
      <span
        className="absolute left-0 top-7 z-[1] h-3.5 w-3.5 rounded-full border-[3px] border-white bg-[#1e5ea8] shadow-md ring-2 ring-[#1e5ea8]/25"
        aria-hidden
      />
      <article
        className={`${editing ? "overflow-visible" : "overflow-hidden"} rounded-[22px] border border-slate-300/90 bg-white shadow-[0_16px_48px_rgba(30,94,168,0.16)] ring-1 ring-slate-300/80`}
        style={{ borderLeftWidth: 5, borderLeftColor: statusHex }}
      >
        <div
          className="flex flex-col gap-3 border-b border-slate-200/90 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between"
          style={{
            background: `linear-gradient(90deg, color-mix(in srgb, ${statusHex} 13%, #eef4fc) 0%, #ffffff 70%)`,
          }}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1">
            <time className="text-sm font-semibold text-slate-900" dateTime={snapshot.happenedAtIso}>
              {snapshot.happenedAtLabel}
            </time>
            <span className="text-sm text-slate-600">{snapshot.loggedByName}</span>
            <span className="crm-badge w-fit text-xs">{snapshot.direction}</span>
            {snapshot.telephonyResult?.trim() ? (
              <span
                className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                  snapshot.telephonyCallbackPending || snapshot.outcomeCode === CALLBACK_NEEDED_OUTCOME_CODE
                    ? "bg-rose-50 text-rose-950 ring-rose-200/90"
                    : "bg-slate-100 text-slate-700 ring-slate-200/90"
                }`}
                title="From RingCentral call log"
              >
                {snapshot.telephonyResult.trim()}
                {snapshot.telephonyCallbackPending || snapshot.outcomeCode === CALLBACK_NEEDED_OUTCOME_CODE
                  ? " · callback"
                  : ""}
              </span>
            ) : null}
            {snapshot.telephonyDraft ? (
              <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-950 ring-1 ring-amber-200/90">
                Telephony draft
              </span>
            ) : null}
            {paymentBadgeLabel ? (
              <span
                className="inline-flex w-fit items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-950 ring-1 ring-emerald-200/90"
                title="A deposit or payment was recorded for this call or its linked booking"
              >
                {paymentBadgeLabel}
              </span>
            ) : null}
            {!editing ? (
              <label className="flex min-w-0 max-w-full flex-col gap-0.5 sm:max-w-[min(100%,280px)]">
                <span className="sr-only">Call result</span>
                <select
                  disabled={quickPending}
                  value={snapshot.outcomeCode}
                  onChange={(e) => {
                    const fd = new FormData();
                    fd.set("clientId", clientId);
                    fd.set("callLogId", snapshot.id);
                    fd.set("outcomeCode", e.target.value);
                    startQuick(() => quickAction(fd));
                  }}
                  className="w-full max-w-[min(100%,280px)] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none disabled:opacity-60"
                >
                  {quickSelectOptions.map((opt) => (
                    <option key={opt.code} value={opt.code}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className={viewBadge.className} style={viewBadge.style}>
                {snapshot.outcomeLabel}
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {hasFollowUp && snapshot.followUpAtLabel ? (
              <div
                className="rounded-xl border px-3 py-2 shadow-sm"
                style={{
                  borderColor: `color-mix(in srgb, ${statusHex} 28%, rgb(203 213 225))`,
                  background: `color-mix(in srgb, ${statusHex} 11%, #ffffff)`,
                  boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
                }}
              >
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-slate-500">
                  Follow-up time
                </p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                  {snapshot.followUpAtLabel}
                </p>
              </div>
            ) : null}
            {!editing ? (
              <button
                type="button"
                onClick={() => {
                  setEditNonce((n) => n + 1);
                  setEditing(true);
                }}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-[#1e5ea8] shadow-sm transition hover:border-[#1e5ea8]/40 hover:bg-[#f0f6fc]"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                Edit
              </button>
            ) : null}
          </div>
        </div>

        {quickState?.ok === false ? (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2 text-xs font-medium text-red-900">
            {quickState.message}
          </div>
        ) : null}

        {linkedAppointment ? (
          <div className="border-b border-sky-200 bg-sky-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Linked booking</p>
            <p className="mt-1 text-sm font-medium text-sky-950">{linkedAppointment.title}</p>
            <p className="text-xs text-sky-900/90">{linkedAppointment.startAtLabel}</p>
            <Link
              href={`/appointments/${linkedAppointment.id}/edit`}
              className="mt-2 inline-block text-sm font-semibold text-sky-900 underline-offset-2 hover:underline"
            >
              Open booking
            </Link>
          </div>
        ) : null}

        {!linkedAppointment && bookBanner && snapshot.outcomeCode === CALL_OUTCOME_BOOKED_CODE ? (
          <div className="flex flex-col gap-3 border-b border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium text-emerald-950">
              Set up a calendar booking with this call&apos;s customer, vehicle, and quote.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  writeBookingFromCallToSession({
                    clientId,
                    clientPhone: snapshot.contactPhone,
                    clientDisplayName: snapshot.contactName,
                    vehicleText: snapshot.vehicleText,
                    title: buildBookingTitleFromCallLines(
                      snapshot.vehicleText,
                      snapshot.productQuoteLines.length
                        ? snapshot.productQuoteLines.map((l) => l.productDisplay).filter(Boolean)
                        : [snapshot.productDisplay || snapshot.product].filter(Boolean),
                    ),
                    notes: buildBookingNotesFromCallLines({
                      linePrices: snapshot.productQuoteLines.length
                        ? snapshot.productQuoteLines.map((l) => l.priceDigits)
                        : [snapshot.priceDigits],
                      summary: snapshot.summary,
                      callbackNotes: snapshot.callbackNotes,
                    }),
                    callLogId: snapshot.id,
                  });
                  setBookBanner(false);
                  router.push("/appointments");
                }}
                className="rounded-xl bg-emerald-800 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-900"
              >
                Set up booking
              </button>
              <button
                type="button"
                onClick={() => setBookBanner(false)}
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100/80"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}

        {!editing ? (
          <div
            className="px-4 py-4"
            style={{
              background: `linear-gradient(180deg, color-mix(in srgb, ${statusHex} 5%, #ffffff) 0%, #ffffff 60%)`,
            }}
          >
            <p className="text-base font-medium leading-relaxed text-slate-900">{snapshot.summary}</p>

            {snapshot.telephonyDraft ? (
              <p className="mt-2 text-xs text-slate-500">
                Imported from RingCentral. Staff summary above is a placeholder — merge in AI notes below or replace when
                you finish the log.
              </p>
            ) : null}

            {snapshot.hasTelephonyRecording ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Recording</p>
                {Array.from(
                  { length: Math.max(1, snapshot.telephonyRecordingSegmentCount ?? 1) },
                  (_, i) => (
                    <div key={i} className={i > 0 ? "mt-4 border-t border-slate-200/90 pt-4" : ""}>
                      {(snapshot.telephonyRecordingSegmentCount ?? 1) > 1 ? (
                        <p className="mb-2 text-[11px] font-medium text-slate-600">
                          Part {i + 1} of {snapshot.telephonyRecordingSegmentCount}
                        </p>
                      ) : null}
                      <TelephonyRecordingPlayer callLogId={snapshot.id} recordingIndex={i} />
                    </div>
                  ),
                )}
              </div>
            ) : snapshot.telephonyDraft ? (
              <p className="mt-3 text-xs text-slate-500">
                No recording link on this log yet. RingCentral often attaches recordings shortly after hangup; run{" "}
                <strong className="font-semibold text-slate-700">Workspace → Sync call logs</strong> to refresh, or wait
                and sync again if the call was recorded.
              </p>
            ) : null}

            {snapshot.hasTelephonyRecording &&
            canRequestTranscription &&
            !snapshot.telephonyTranscript?.trim() &&
            !snapshot.telephonyAiPending ? (
              <div className="mt-3 rounded-xl border border-violet-100 bg-violet-50/50 px-3 py-2.5">
                <p className="text-xs leading-relaxed text-slate-600">
                  Transcripts are not automatic unless{" "}
                  <span className="font-medium text-slate-800">RINGCENTRAL_AUTO_TRANSCRIBE=true</span> and RingCentral can
                  reach your <span className="font-medium text-slate-800">APP_URL</span> webhook. You can start a job now
                  for this recording.
                </p>
                <button
                  type="button"
                  disabled={transcribePending}
                  onClick={() => {
                    setTranscribePending(true);
                    setTranscribeNote(null);
                    void (async () => {
                      try {
                        const res = await fetch("/api/ringcentral/transcribe", {
                          method: "POST",
                          credentials: "include",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ callLogId: snapshot.id }),
                        });
                        const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
                        if (!res.ok) {
                          const msg =
                            (typeof data?.message === "string" && data.message) ||
                            (typeof data?.error === "string" && data.error) ||
                            `Request failed (${res.status}).`;
                          setTranscribeNote(msg);
                          return;
                        }
                        setTranscribeNote(
                          "Transcription queued. Refresh in a moment — text appears below when RingCentral finishes.",
                        );
                        router.refresh();
                      } catch (e) {
                        setTranscribeNote(e instanceof Error ? e.message : "Request failed.");
                      } finally {
                        setTranscribePending(false);
                      }
                    })();
                  }}
                  className="mt-2 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-800 disabled:opacity-50"
                >
                  {transcribePending ? "Starting…" : "Request AI transcript"}
                </button>
                {transcribeNote ? (
                  <p className="mt-2 text-xs text-slate-700" role="status">
                    {transcribeNote}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!canRequestTranscription &&
            snapshot.hasTelephonyRecording &&
            !snapshot.telephonyTranscript?.trim() &&
            !snapshot.telephonyAiPending ? (
              <p className="mt-3 text-xs text-slate-500">
                No AI transcript on file. Someone with call-log edit access or an admin can request one from this card, or
                enable auto-transcribe in Workspace.
              </p>
            ) : null}

            {snapshot.telephonyAiPending ? (
              <p className="mt-3 text-xs font-medium text-slate-500">AI transcript is processing…</p>
            ) : null}

            {snapshot.telephonyTranscript?.trim() ? (
              <div className="mt-4 rounded-xl border border-violet-200/80 bg-violet-50/50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-violet-900/90">AI transcript</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {snapshot.telephonyTranscript.trim()}
                </p>
              </div>
            ) : null}

            {snapshot.telephonyGeminiStructured ? (
              <TelephonyGeminiInsightsBlock insights={snapshot.telephonyGeminiStructured} />
            ) : snapshot.telephonyAiSummary?.trim() ? (
              <div className="mt-3 rounded-xl border border-indigo-200/80 bg-indigo-50/50 px-3 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-indigo-900/90">AI summary</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">
                  {snapshot.telephonyAiSummary.trim()}
                </p>
              </div>
            ) : null}

            <dl className="mt-4 grid gap-2 border-t border-slate-200 pt-4 text-sm sm:grid-cols-[minmax(0,11rem)_1fr]">
              {showPhoneRow ? (
                <>
                  <dt className="text-slate-500">Different number on this call</dt>
                  <dd className="text-slate-900">{fieldOrDash(snapshot.contactPhone)}</dd>
                </>
              ) : null}
              {showNameRow ? (
                <>
                  <dt className="text-slate-500">Different name on this call</dt>
                  <dd className="text-slate-900">{fieldOrDash(snapshot.contactName)}</dd>
                </>
              ) : null}
              <dt className="text-slate-500">Vehicle on this call</dt>
              <dd className="text-slate-900">{fieldOrDash(snapshot.vehicleText)}</dd>
              {snapshot.productQuoteLines.length ? (
                <>
                  <dt className="text-slate-500">Products / quotes</dt>
                  <dd className="text-slate-900">
                    <ul className="list-none space-y-1.5 pl-0">
                      {snapshot.productQuoteLines.map((l, idx) => (
                        <li key={idx}>
                          <span className="font-medium text-slate-900">{fieldOrDash(l.productDisplay)}</span>
                          {l.priceText?.trim() || l.priceDigits ? (
                            <span className="text-slate-600">
                              {" "}
                              — {formatQuoteDisplay(l.priceText ?? l.priceDigits)}
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </>
              ) : (
                <>
                  <dt className="text-slate-500">Product / service</dt>
                  <dd className="text-slate-900">{fieldOrDash(snapshot.productDisplay || snapshot.product)}</dd>
                  <dt className="text-slate-500">Price / quote</dt>
                  <dd className="text-slate-900">{formatQuoteDisplay(snapshot.priceText ?? snapshot.priceDigits)}</dd>
                </>
              )}
              <dt className="text-slate-500">Found us through</dt>
              <dd className="text-slate-900">{fieldOrDash(snapshot.sourceDisplay)}</dd>
              <dt className="text-slate-500">Callback notes</dt>
              <dd className="whitespace-pre-wrap text-slate-800 sm:col-span-2">{fieldOrDash(snapshot.callbackNotes)}</dd>
              <dt className="text-slate-500">Staff only</dt>
              <dd className="whitespace-pre-wrap text-slate-700 sm:col-span-2">{fieldOrDash(snapshot.internalNotes)}</dd>
            </dl>
          </div>
        ) : (
          <CallLogEditForm
            key={`${snapshot.id}-${editNonce}`}
            clientId={clientId}
            snapshot={snapshot}
            resultOptions={resultOptions}
            productServiceOptions={productServiceOptions}
            leadSourceOptions={leadSourceOptions}
            onCancel={() => setEditing(false)}
            onSaved={(oc) => {
              setEditing(false);
              if (oc === CALL_OUTCOME_BOOKED_CODE) setBookBanner(true);
            }}
          />
        )}
      </article>
    </li>
  );
}
