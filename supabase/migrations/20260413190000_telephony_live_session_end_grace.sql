-- Defer telephony session-end import: keep a live row through a short grace window so hunt/forward legs
-- can settle before we write call-log stubs (avoids "Missed" flashing while the call is still completing).
ALTER TABLE "TelephonyLiveSession"
  ADD COLUMN IF NOT EXISTS "endingGraceUntil" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "endingStubJson" TEXT,
  ADD COLUMN IF NOT EXISTS "endingToken" TEXT;
