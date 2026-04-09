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
};
