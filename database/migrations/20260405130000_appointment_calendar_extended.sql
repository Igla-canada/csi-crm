-- Google Calendar–style fields for CRM appointments (event / task / schedule kinds, location, guests, visibility).

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "calendarEntryKind" TEXT NOT NULL DEFAULT 'EVENT';
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "location" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "guestEmails" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "allDay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "recurrenceRule" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "showAs" TEXT NOT NULL DEFAULT 'busy';
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'default';
