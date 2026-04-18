-- Deferred RingCentral recording URI enrichment (cron); webhook no longer chains heavy sync retries.

ALTER TABLE "CallLog"
  ADD COLUMN IF NOT EXISTS "telephonyRecordingEnrichStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "telephonyRecordingEnrichAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "telephonyRecordingEnrichLastAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "telephonyRecordingEnrichNextAt" TIMESTAMP(3);

COMMENT ON COLUMN "CallLog"."telephonyRecordingEnrichStatus" IS 'pending | ready | none | retry — cron fills recording after webhook; null = not applicable (no RingCentral id).';
COMMENT ON COLUMN "CallLog"."telephonyRecordingEnrichAttempts" IS 'Number of cron/sync attempts to attach a recording URI.';
COMMENT ON COLUMN "CallLog"."telephonyRecordingEnrichLastAt" IS 'Last recording-enrichment attempt at.';
COMMENT ON COLUMN "CallLog"."telephonyRecordingEnrichNextAt" IS 'Do not retry enrichment before this time (backoff).';

CREATE INDEX IF NOT EXISTS "CallLog_telephonyRecordingEnrich_cron_idx"
  ON "CallLog" ("telephonyRecordingEnrichNextAt", "happenedAt" DESC)
  WHERE "ringCentralCallLogId" IS NOT NULL
    AND "telephonyRecordingEnrichStatus" IN ('pending', 'retry');

UPDATE "CallLog"
SET
  "telephonyRecordingEnrichStatus" = 'ready',
  "telephonyRecordingEnrichNextAt" = NULL
WHERE "ringCentralCallLogId" IS NOT NULL
  AND (
    (COALESCE(TRIM("telephonyRecordingContentUri"), '') <> '')
    OR (
      "telephonyRecordingRefs" IS NOT NULL
      AND jsonb_typeof("telephonyRecordingRefs") = 'array'
      AND jsonb_array_length("telephonyRecordingRefs") > 0
    )
  );

UPDATE "CallLog"
SET "telephonyRecordingEnrichStatus" = NULL, "telephonyRecordingEnrichNextAt" = NULL
WHERE "ringCentralCallLogId" IS NULL;

UPDATE "CallLog"
SET
  "telephonyRecordingEnrichStatus" = 'pending',
  "telephonyRecordingEnrichAttempts" = 0,
  "telephonyRecordingEnrichNextAt" = NULL
WHERE "ringCentralCallLogId" IS NOT NULL
  AND "telephonyRecordingEnrichStatus" IS DISTINCT FROM 'ready'
  AND COALESCE(TRIM("telephonyRecordingContentUri"), '') = ''
  AND (
    "telephonyRecordingRefs" IS NULL
    OR jsonb_typeof("telephonyRecordingRefs") <> 'array'
    OR jsonb_array_length(COALESCE("telephonyRecordingRefs", '[]'::jsonb)) = 0
  )
  AND "happenedAt" > (CURRENT_TIMESTAMP - INTERVAL '30 days');
