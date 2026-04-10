-- Multiple RingCentral recording segments per call (hold, transfer, multi-leg).
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "telephonyRecordingRefs" JSONB;

COMMENT ON COLUMN "CallLog"."telephonyRecordingRefs" IS 'RingCentral recordings [{id, contentUri}, …]; primary row mirrors telephonyRecordingId / telephonyRecordingContentUri (first entry).';
