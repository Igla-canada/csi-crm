/** Serializable row for `GET /api/calls/inbound-history` and the client table. */
export type InboundCallHistoryRowDto = {
  id: string;
  clientId: string;
  clientDisplayName: string;
  contactPhone: string | null;
  contactName: string | null;
  happenedAt: string;
  telephonyDraft: boolean;
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
};
