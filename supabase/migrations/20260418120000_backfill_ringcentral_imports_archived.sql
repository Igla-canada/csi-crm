-- RingCentral imports should use ARCHIVED (see CallResultOption) so they do not appear as open follow-ups.
-- One-time fix for rows created before ARCHIVED existed or before sync started updating outcomes.

UPDATE "CallLog"
SET
  "outcomeCode" = 'ARCHIVED',
  "followUpAt" = NULL
WHERE "ringCentralCallLogId" IS NOT NULL
  AND (
    "telephonyDraft" = true
    OR TRIM(COALESCE("summary", '')) = 'RingCentral call — complete this log (result, vehicle, quotes) when you review it.'
  );
