-- Structured Gemini output + in-flight flag for manual transcription from call history.
ALTER TABLE "CallLog"
  ADD COLUMN IF NOT EXISTS "telephonyGeminiStructured" JSONB,
  ADD COLUMN IF NOT EXISTS "telephonyGeminiPending" BOOLEAN NOT NULL DEFAULT false;
