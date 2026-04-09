-- RingCentral call disposition (answered / voicemail / missed, etc.) + task queue flag for callback-needed imports.

ALTER TABLE "CallLog"
  ADD COLUMN IF NOT EXISTS "telephonyResult" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyCallbackPending" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "CallLog_telephonyCallbackPending_idx"
  ON "CallLog" ("happenedAt" DESC)
  WHERE "telephonyCallbackPending" = true;
