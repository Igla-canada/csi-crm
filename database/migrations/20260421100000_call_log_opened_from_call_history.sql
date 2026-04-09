-- Track “Open log” from Call history so the button can stay disabled after first use.
ALTER TABLE "CallLog"
  ADD COLUMN IF NOT EXISTS "openedFromCallHistoryAt" TIMESTAMP(3);
