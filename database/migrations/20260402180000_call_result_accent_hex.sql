-- Canonical copy: supabase/migrations/20260402180000_call_result_accent_hex.sql
ALTER TABLE "CallResultOption" ADD COLUMN IF NOT EXISTS "accentHex" TEXT NULL;
