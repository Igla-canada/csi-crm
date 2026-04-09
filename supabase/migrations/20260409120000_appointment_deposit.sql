-- Deposit amount recorded on a booking (CRM-only; digits stored like call quote).
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "depositText" TEXT;
