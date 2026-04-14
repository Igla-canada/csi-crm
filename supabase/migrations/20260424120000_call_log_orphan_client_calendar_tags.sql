-- Orphan telephony rows: no Client until staff saves a call log from history.
-- contactPhoneNormalized: link orphans when first call log creates the client.

ALTER TABLE "CallLog" ALTER COLUMN "clientId" DROP NOT NULL;

ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "contactPhoneNormalized" TEXT;

CREATE INDEX IF NOT EXISTS "CallLog_contactPhoneNormalized_idx"
  ON "CallLog" ("contactPhoneNormalized")
  WHERE "contactPhoneNormalized" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "CallLog_clientId_null_phone_idx"
  ON "CallLog" ("contactPhoneNormalized", "happenedAt" DESC)
  WHERE "clientId" IS NULL AND "contactPhoneNormalized" IS NOT NULL;

-- Backfill normalized phone from stored contactPhone (10+ digits after strip).
UPDATE "CallLog"
SET "contactPhoneNormalized" = CASE
  WHEN length(regexp_replace(coalesce("contactPhone", ''), '\D', '', 'g')) = 11
    AND left(regexp_replace(coalesce("contactPhone", ''), '\D', '', 'g'), 1) = '1'
  THEN substring(regexp_replace(coalesce("contactPhone", ''), '\D', '', 'g') from 2 for 10)
  WHEN length(regexp_replace(coalesce("contactPhone", ''), '\D', '', 'g')) >= 10
  THEN right(regexp_replace(coalesce("contactPhone", ''), '\D', '', 'g'), 10)
  ELSE NULL
END
WHERE ("contactPhoneNormalized" IS NULL OR trim("contactPhoneNormalized") = '')
  AND "contactPhone" IS NOT NULL
  AND length(regexp_replace("contactPhone", '\D', '', 'g')) >= 10;

-- Rows that already have a client: prefer primary ContactPoint normalization when missing.
UPDATE "CallLog" cl
SET "contactPhoneNormalized" = cp."normalizedValue"
FROM "ContactPoint" cp
WHERE cl."clientId" IS NOT NULL
  AND (cl."contactPhoneNormalized" IS NULL OR trim(cl."contactPhoneNormalized") = '')
  AND cp."clientId" = cl."clientId"
  AND cp."kind" = 'PHONE'
  AND cp."isPrimary" = true
  AND cp."normalizedValue" IS NOT NULL
  AND length(trim(cp."normalizedValue")) >= 7;

CREATE TABLE IF NOT EXISTS "CalendarTagOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "googleColorId" TEXT,
    "accentHex" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarTagOption_pkey" PRIMARY KEY ("code")
);

INSERT INTO "CalendarTagOption" ("code", "label", "googleColorId", "accentHex", "sortOrder", "active")
VALUES
  ('DEFAULT', 'Default', '1', NULL, 0, true),
  ('DEPOSIT', 'Deposit taken', '10', '#0f9d58', 10, true),
  ('FOLLOWUP', 'Needs follow-up', '6', '#f4511e', 20, true),
  ('CONFIRMED', 'Confirmed', '9', '#039be5', 30, true)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "calendarTagCode" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_calendarTagCode_fkey'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT "Appointment_calendarTagCode_fkey"
      FOREIGN KEY ("calendarTagCode") REFERENCES "CalendarTagOption"("code") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
