"use client";

import { useEffect, useRef, useState } from "react";

export const CALL_LOG_RECORDING_PLAYBACK_RATES = [1, 1.5, 2, 2.5] as const;

function recordingStreamUrl(callLogId: string, recordingIndex: number): string {
  const id = encodeURIComponent(callLogId);
  return recordingIndex > 0
    ? `/api/ringcentral/recording?callLogId=${id}&recordingIndex=${recordingIndex}`
    : `/api/ringcentral/recording?callLogId=${id}`;
}

/** Only one CRM recording plays at a time (table, card, edit form share this). */
let lastActiveCallLogAudio: HTMLAudioElement | null = null;

function pauseOtherCallLogRecordings(current: HTMLAudioElement) {
  if (lastActiveCallLogAudio && lastActiveCallLogAudio !== current) {
    lastActiveCallLogAudio.pause();
  }
  lastActiveCallLogAudio = current;
}

export type CallLogRecordingPlaybackProps = {
  callLogId: string;
  recordingIndex?: number;
  /**
   * When true: smaller speed buttons + native `<audio controls>` (reliable in narrow cells and after
   * opening a call in edit mode). When false: matches the main call card layout.
   */
  compact?: boolean;
};

export function CallLogRecordingPlayback({
  callLogId,
  recordingIndex = 0,
  compact = false,
}: CallLogRecordingPlaybackProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const src = recordingStreamUrl(callLogId, recordingIndex);

  useEffect(() => {
    setLoadError(null);
  }, [src]);

  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (!el) return;
      el.pause();
      if (lastActiveCallLogAudio === el) lastActiveCallLogAudio = null;
    };
  }, []);

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

  const speedBtnClassCompact = (active: boolean) =>
    `rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition ${
      active
        ? "bg-[#1e5ea8] text-white ring-1 ring-[#1e5ea8]/40"
        : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  const speedRow = (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "gap-1" : ""}`}>
      <span
        className={`font-semibold uppercase tracking-wide text-slate-500 ${
          compact ? "text-[9px]" : "text-[0.65rem]"
        }`}
      >
        Speed
      </span>
      {CALL_LOG_RECORDING_PLAYBACK_RATES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => applyRate(r)}
          className={compact ? speedBtnClassCompact(playbackRate === r) : speedBtnClass(playbackRate === r)}
          title={`Play at ${r}× speed`}
        >
          {r === 1 ? "1×" : `${r}×`}
        </button>
      ))}
    </div>
  );

  const audioEl = (
    <audio
      key={src}
      ref={audioRef}
      controls
      playsInline
      preload={compact ? "metadata" : "metadata"}
      className={compact ? "h-8 w-full min-w-[100px] max-w-[240px]" : "h-9 w-full max-w-md"}
      src={src}
      onPlay={() => {
        const el = audioRef.current;
        if (el) pauseOtherCallLogRecordings(el);
      }}
      onLoadedMetadata={(e) => {
        setLoadError(null);
        e.currentTarget.playbackRate = playbackRate;
      }}
      onError={() => {
        setLoadError(
          "Could not load this segment. Use Sync this call or Workspace → Sync call logs, and check RingCentral access.",
        );
      }}
    >
      Your browser does not support audio playback.
    </audio>
  );

  if (compact) {
    return (
      <div className="space-y-1">
        {speedRow}
        {audioEl}
        {loadError ? (
          <p className="max-w-[12rem] text-[10px] font-medium text-amber-900" role="alert">
            {loadError}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {speedRow}
      {audioEl}
      {loadError ? (
        <p className="text-xs font-medium text-amber-900" role="alert">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
