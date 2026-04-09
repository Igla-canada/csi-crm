-- Canonical copy for Supabase CLI: supabase/migrations/20260402140000_call_result_accent.sql
-- Add per–call-result color preset (matches src/lib/call-result-accents.ts)
ALTER TABLE "CallResultOption" ADD COLUMN IF NOT EXISTS "accentKey" TEXT NOT NULL DEFAULT 'slate';

UPDATE "CallResultOption" SET "accentKey" = CASE "code"
  WHEN 'QUOTE_SENT' THEN 'sky'
  WHEN 'CALLBACK_NEEDED' THEN 'amber'
  WHEN 'BOOKED' THEN 'cyan'
  WHEN 'SUPPORT' THEN 'violet'
  WHEN 'NO_SOLUTION' THEN 'rose'
  WHEN 'COMPLETED' THEN 'emerald'
  WHEN 'FOLLOW_UP' THEN 'orange'
  ELSE "accentKey"
END;
