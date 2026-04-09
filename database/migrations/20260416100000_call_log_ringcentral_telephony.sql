-- Passive telephony (e.g. RingCentral): recording refs + AI text; staff still edit logs manually.

ALTER TABLE "CallLog"
  ADD COLUMN IF NOT EXISTS "ringCentralCallLogId" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyRecordingId" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyRecordingContentUri" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyMetadata" JSONB,
  ADD COLUMN IF NOT EXISTS "telephonyTranscript" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyAiSummary" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyDraft" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "telephonyAiJobId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CallLog_ringCentralCallLogId_key"
  ON "CallLog" ("ringCentralCallLogId")
  WHERE "ringCentralCallLogId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "CallLog_telephonyAiJobId_idx"
  ON "CallLog" ("telephonyAiJobId")
  WHERE "telephonyAiJobId" IS NOT NULL;
