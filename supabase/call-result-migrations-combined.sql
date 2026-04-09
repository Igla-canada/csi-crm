-- Run once in Supabase: Dashboard → SQL → New query → paste → Run.
-- Same as supabase/migrations/20260402140000 + 20260402180000 (safe to re-run: IF NOT EXISTS).

-- Per–call-result color preset (matches src/lib/call-result-accents.ts)
ALTER TABLE "CallResultOption" ADD COLUMN IF NOT EXISTS "accentKey" TEXT NOT NULL DEFAULT 'slate';

UPDATE "CallResultOption" SET "accentKey" = CASE "code"
  WHEN 'QUOTE_SENT' THEN 'sky'
  WHEN 'CALLBACK_NEEDED' THEN 'amber'
  WHEN 'BOOKED' THEN 'cyan'
  WHEN 'SUPPORT' THEN 'violet'
  WHEN 'NO_SOLUTION' THEN 'rose'
  WHEN 'COMPLETED' THEN 'emerald'
  WHEN 'ARCHIVED' THEN 'slate'
  WHEN 'FOLLOW_UP' THEN 'orange'
  ELSE "accentKey"
END;

-- Optional exact color override (#rrggbb)
ALTER TABLE "CallResultOption" ADD COLUMN IF NOT EXISTS "accentHex" TEXT NULL;
