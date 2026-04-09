-- Link bookings to originating call logs; explicit payment/deposit rows for reconciliation.

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "callLogId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_callLogId_fkey'
  ) THEN
    ALTER TABLE "Appointment"
      ADD CONSTRAINT "Appointment_callLogId_fkey"
      FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "Appointment_callLogId_key" ON "Appointment" ("callLogId") WHERE "callLogId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Appointment_clientId_callLogId_idx" ON "Appointment" ("clientId") WHERE "callLogId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "PaymentEvent" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "callLogId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DEPOSIT',
    "amountCents" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PaymentEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentEvent_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PaymentEvent_kind_check" CHECK ("kind" IN ('DEPOSIT', 'PAYMENT', 'REFUND')),
    CONSTRAINT "PaymentEvent_method_check" CHECK ("method" IN ('CASH', 'CARD', 'CHECK', 'ETRANSFER', 'OTHER')),
    CONSTRAINT "PaymentEvent_amountCents_positive" CHECK ("amountCents" > 0)
);

CREATE INDEX IF NOT EXISTS "PaymentEvent_clientId_receivedAt_idx" ON "PaymentEvent" ("clientId", "receivedAt");
CREATE INDEX IF NOT EXISTS "PaymentEvent_appointmentId_idx" ON "PaymentEvent" ("appointmentId");
CREATE INDEX IF NOT EXISTS "PaymentEvent_receivedAt_idx" ON "PaymentEvent" ("receivedAt");
