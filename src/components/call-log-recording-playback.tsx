"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export const CALL_LOG_RECORDING_PLAYBACK_RATES = [1, 1.5, 2, 2.5] as const;

function recordingStreamUrl(callLogId: string, recordingIndex: number): string {
  const id = encodeURIComponent(callLogId);
  return recordingIndex > 0
    ? `/api/ringcentral/recording?callLogId=${id}&recordingIndex=${recordingIndex}`
    : `/api/ringcentral/recording?callLogId=${id}`;
}

/** Only one CRM recording plays at a time (table play buttons, full player on call log share this). */
let lastActiveCallLogAudio: HTMLAudioElement | null = null;

function pauseOtherCallLogRecordings(current: HTMLAudioElement) {
  if (lastActiveCallLogAudio && lastActiveCallLogAudio !== current) {
    lastActiveCallLogAudio.pause();
  }
  lastActiveCallLogAudio = current;
}

/**
 * Call history table only: hidden audio + play/pause. Full speed + scrubber live on the client call log.
 */
export function CallLogRecordingPlayButton({
  callLogId,
  recordingIndex,
  totalSegments,
}: {
  callLogId: string;
  recordingIndex: number;
  totalSegments: number;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const src = recordingStreamUrl(callLogId, recordingIndex);

  useEffect(() => {
    const el = audioRef.current;
    return () => {
      if (!el) return;
      el.pause();
      if (lastActiveCallLogAudio === el) lastActiveCallLogAudio = null;
    };
  }, []);

  const ariaPlay =
    totalSegments <= 1
      ? "Play call recording"
      : `Play recording part ${recordingIndex + 1} of ${totalSegments}`;
  const ariaPause =
    totalSegments <= 1 ? "Pause call recording" : `Pause recording part ${recordingIndex + 1}`;

  return (
    <>
      <audio
        ref={audioRef}
        src={src}
        preload="none"
        playsInline
        onPlay={() => {
          const el = audioRef.current;
          if (el) pauseOtherCallLogRecordings(el);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
        aria-label={playing ? ariaPause : ariaPlay}
        title={playing ? ariaPause : ariaPlay}
        onClick={() => {
          const el = audioRef.current;
          if (!el) return;
          if (playing) el.pause();
          else
            void el.play().catch((err) => {
              console.warn("[call history] Could not play recording:", err);
            });
        }}
      >
        {playing ? (
          <Pause className="h-3 w-3" aria-hidden />
        ) : (
          <Play className="ml-px h-3 w-3" aria-hidden />
        )}
      </button>
    </>
  );
}

export type CallLogRecordingPlaybackProps = {
  callLogId: string;
  recordingIndex?: number;
};

/** Full player (speed + native controls + errors) — client call log read/edit only, not the history table. */
export function CallLogRecordingPlayback({
  callLogId,
  recordingIndex = 0,
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

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-slate-500">Speed</span>
        {CALL_LOG_RECORDING_PLAYBACK_RATES.map((r) => (
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
        playsInline
        preload="metadata"
        className="h-9 w-full max-w-md"
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
            "Could not load this segment. Use Sync this call below, or Workspace → Sync call logs, and check RingCentral access.",
          );
        }}
      >
        Your browser does not support audio playback.
      </audio>
      {loadError ? (
        <p className="text-xs font-medium text-amber-900" role="alert">
          {loadError}
        </p>
      ) : null}
    </div>
  );
}
