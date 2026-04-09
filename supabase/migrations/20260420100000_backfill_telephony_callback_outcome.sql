-- Voicemail / missed RingCentral imports should use CALLBACK_NEEDED so they appear on Tasks until staff sets Completed or Archived.

UPDATE "CallLog"
SET "outcomeCode" = 'CALLBACK_NEEDED'
WHERE "telephonyCallbackPending" = true
  AND "outcomeCode" = 'ARCHIVED';
