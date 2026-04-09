-- Per-user Google Calendar OAuth (refresh token + optional calendar id; "primary" = main calendar when id null)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleRefreshToken" TEXT NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleCalendarId" TEXT NULL;
