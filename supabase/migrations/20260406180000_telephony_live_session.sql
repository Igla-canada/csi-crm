-- Real-time live call dock: RingCentral account telephony session webhooks upsert rows here.
CREATE TABLE IF NOT EXISTS "TelephonyLiveSession" (
  "telephonySessionId" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "statusCode" TEXT NOT NULL,
  "phoneDigits" TEXT NOT NULL DEFAULT '',
  "phoneDisplay" TEXT NOT NULL,
  "callerName" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelephonyLiveSession_pkey" PRIMARY KEY ("telephonySessionId")
);

CREATE INDEX IF NOT EXISTS "TelephonyLiveSession_updatedAt_idx"
  ON "TelephonyLiveSession" ("updatedAt");
