-- Run in Supabase SQL Editor (or psql) on an empty public schema to match the CRM app.
-- Table and column names use quoted PascalCase / camelCase like the original ORM mapping.

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'SALES', 'TECH');
CREATE TYPE "ContactKind" AS ENUM ('PHONE', 'EMAIL');
CREATE TYPE "CallDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "OpportunityStatus" AS ENUM ('NEW', 'QUOTED', 'BOOKED', 'WON', 'LOST', 'SUPPORT');
CREATE TYPE "AppointmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "GoogleSyncStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'SYNCED', 'FAILED');
CREATE TYPE "ImportStatus" AS ENUM ('DRAFT', 'IMPORTED', 'PARTIAL');
CREATE TYPE "ImportRowStatus" AS ENUM ('IMPORTED', 'SKIPPED', 'REVIEW');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "team" TEXT,
    "privilegeOverrides" JSONB,
    "googleRefreshToken" TEXT,
    "googleCalendarId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "companyName" TEXT,
    "source" TEXT,
    "tags" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactPoint" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "kind" "ContactKind" NOT NULL,
    "value" TEXT NOT NULL,
    "normalizedValue" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ContactPoint_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ContactPoint_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ContactPoint_clientId_kind_idx" ON "ContactPoint"("clientId", "kind");
CREATE INDEX "ContactPoint_normalizedValue_idx" ON "ContactPoint"("normalizedValue");

CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "year" INTEGER,
    "make" TEXT,
    "model" TEXT,
    "trim" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Vehicle_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CallResultOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accentKey" TEXT NOT NULL DEFAULT 'slate',
    "accentHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallResultOption_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "BookingTypeOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "accentKey" TEXT NOT NULL DEFAULT 'slate',
    "accentHex" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BookingTypeOption_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "ProductServiceOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "matchTerms" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductServiceOption_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "LeadSourceOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSourceOption_pkey" PRIMARY KEY ("code")
);

CREATE TABLE "CallLog" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "direction" "CallDirection" NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contactPhone" TEXT,
    "contactName" TEXT,
    "vehicleText" TEXT,
    "product" TEXT,
    "priceText" TEXT,
    "productQuoteLines" JSONB,
    "callbackNotes" TEXT,
    "source" TEXT,
    "summary" TEXT NOT NULL,
    "outcomeCode" TEXT NOT NULL,
    "followUpAt" TIMESTAMP(3),
    "internalNotes" TEXT,
    "ringCentralCallLogId" TEXT,
    "telephonyRecordingId" TEXT,
    "telephonyRecordingContentUri" TEXT,
    "telephonyRecordingRefs" JSONB,
    "telephonyMetadata" JSONB,
    "telephonyTranscript" TEXT,
    "telephonyAiSummary" TEXT,
    "telephonyDraft" BOOLEAN NOT NULL DEFAULT false,
    "telephonyAiJobId" TEXT,
    "telephonyGeminiStructured" JSONB,
    "telephonyGeminiPending" BOOLEAN NOT NULL DEFAULT false,
    "telephonyResult" TEXT,
    "telephonyCallbackPending" BOOLEAN NOT NULL DEFAULT false,
    "openedFromCallHistoryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CallLog_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CallLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CallLog_outcomeCode_fkey" FOREIGN KEY ("outcomeCode") REFERENCES "CallResultOption"("code") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CallLog_ringCentralCallLogId_key" ON "CallLog"("ringCentralCallLogId") WHERE "ringCentralCallLogId" IS NOT NULL;
CREATE INDEX "CallLog_telephonyAiJobId_idx" ON "CallLog"("telephonyAiJobId") WHERE "telephonyAiJobId" IS NOT NULL;
CREATE INDEX "CallLog_clientId_happenedAt_idx" ON "CallLog"("clientId", "happenedAt");
CREATE INDEX "CallLog_userId_happenedAt_idx" ON "CallLog"("userId", "happenedAt");
CREATE INDEX "CallLog_followUpAt_idx" ON "CallLog"("followUpAt");
CREATE INDEX "CallLog_telephonyCallbackPending_idx" ON "CallLog"("happenedAt" DESC) WHERE "telephonyCallbackPending" = true;

CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "product" TEXT NOT NULL,
    "status" "OpportunityStatus" NOT NULL,
    "estimateText" TEXT,
    "summary" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Opportunity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Opportunity_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Opportunity_clientId_status_idx" ON "Opportunity"("clientId", "status");

CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" "AppointmentStatus" NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "resourceKey" TEXT,
    "capacitySlot" TEXT,
    "googleEventId" TEXT,
    "googleSyncStatus" "GoogleSyncStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "calendarEntryKind" TEXT NOT NULL DEFAULT 'EVENT',
    "location" TEXT,
    "guestEmails" TEXT,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "showAs" TEXT NOT NULL DEFAULT 'busy',
    "visibility" TEXT NOT NULL DEFAULT 'default',
    "notes" TEXT,
    "depositText" TEXT,
    "callLogId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_type_fkey" FOREIGN KEY ("type") REFERENCES "BookingTypeOption"("code") ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT "Appointment_callLogId_fkey" FOREIGN KEY ("callLogId") REFERENCES "CallLog"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Appointment_startAt_endAt_idx" ON "Appointment"("startAt", "endAt");
CREATE INDEX "Appointment_resourceKey_startAt_idx" ON "Appointment"("resourceKey", "startAt");
CREATE UNIQUE INDEX "Appointment_callLogId_key" ON "Appointment"("callLogId") WHERE "callLogId" IS NOT NULL;
CREATE INDEX "Appointment_clientId_callLogId_idx" ON "Appointment"("clientId") WHERE "callLogId" IS NOT NULL;

CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'DRAFT',
    "originalCsvText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ImportBatch_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "matchedClientId" TEXT,
    "rowNumber" INTEGER NOT NULL,
    "normalizedPhone" TEXT,
    "status" "ImportRowStatus" NOT NULL,
    "warning" TEXT,
    "rawJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportRow_matchedClientId_fkey" FOREIGN KEY ("matchedClientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "ImportRow_batchId_status_idx" ON "ImportRow"("batchId", "status");
CREATE INDEX "ImportRow_normalizedPhone_idx" ON "ImportRow"("normalizedPhone");

CREATE TABLE "CalendarConfig" (
    "id" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "maxParallelBookings" INTEGER NOT NULL DEFAULT 5,
    "defaultDurationMins" INTEGER NOT NULL DEFAULT 60,
    "workingHoursJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CalendarConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "detailsJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "AuditLog_targetType_createdAt_idx" ON "AuditLog"("targetType", "createdAt");

CREATE TABLE "TelephonyLiveSession" (
    "telephonySessionId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "statusCode" TEXT NOT NULL,
    "phoneDigits" TEXT NOT NULL DEFAULT '',
    "phoneDisplay" TEXT NOT NULL,
    "callerName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelephonyLiveSession_pkey" PRIMARY KEY ("telephonySessionId")
);
CREATE INDEX "TelephonyLiveSession_updatedAt_idx" ON "TelephonyLiveSession"("updatedAt");

CREATE TABLE "PaymentEvent" (
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
CREATE INDEX "PaymentEvent_clientId_receivedAt_idx" ON "PaymentEvent"("clientId", "receivedAt");
CREATE INDEX "PaymentEvent_appointmentId_idx" ON "PaymentEvent"("appointmentId");
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");
