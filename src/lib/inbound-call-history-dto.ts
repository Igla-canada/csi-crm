/** Serializable row for `GET /api/calls/inbound-history` and the client table. */
export type InboundCallHistoryRowDto = {
  id: string;
  clientId: string;
  clientDisplayName: string;
  contactPhone: string | null;
  contactName: string | null;
  happenedAt: string;
  telephonyDraft: boolean;
  /** Staff-edited `CallLog.summary` (not AI). */
  summary: string;
  openedFromCallHistoryAt: string | null;
  ringCentralCallLogId: string | null;
  openLogDisabled: boolean;
  /** RingCentral / carrier-style outcome when imported. */
  telephonyResult: string | null;
  /** Call length in seconds from telephony metadata, when available. */
  durationSeconds: number | null;
  /** Number of distinct recording files on the log. */
  recordingCount: number;
  /** Table preview: `telephonyAiSummary` when present, else staff `summary`. */
  displaySummary: string;
  /** True when a transcript or AI summary exists (hides the Transcript button). */
  hasTranscription: boolean;
  geminiTranscribePending: boolean;
  rcAiTranscribePending: boolean;
};
