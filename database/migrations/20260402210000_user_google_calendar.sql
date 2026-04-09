-- Canonical copy: supabase/migrations/20260402210000_user_google_calendar.sql
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleRefreshToken" TEXT NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleCalendarId" TEXT NULL;
