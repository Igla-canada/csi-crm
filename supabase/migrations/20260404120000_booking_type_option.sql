-- Configurable appointment types + colors (like CallResultOption).

CREATE TABLE IF NOT EXISTS "BookingTypeOption" (
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

INSERT INTO "BookingTypeOption" ("code", "label", "sortOrder", "isBuiltIn", "active", "accentKey", "accentHex", "createdAt")
VALUES
    ('INSTALL', 'Install', 10, true, true, 'indigo', NULL, CURRENT_TIMESTAMP),
    ('INSPECTION', 'Inspection', 20, true, true, 'sky', NULL, CURRENT_TIMESTAMP),
    ('SUPPORT', 'Support', 30, true, true, 'violet', NULL, CURRENT_TIMESTAMP),
    ('QUOTE_VISIT', 'Quote visit', 40, true, true, 'amber', NULL, CURRENT_TIMESTAMP),
    ('PHONE_CALL', 'Phone call', 50, true, true, 'cyan', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "Appointment" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "Appointment" ALTER COLUMN "type" TYPE TEXT USING ("type"::TEXT);

ALTER TABLE "Appointment" DROP CONSTRAINT IF EXISTS "Appointment_type_fkey";
ALTER TABLE "Appointment"
    ADD CONSTRAINT "Appointment_type_fkey"
    FOREIGN KEY ("type") REFERENCES "BookingTypeOption" ("code") ON UPDATE CASCADE ON DELETE RESTRICT;

DROP TYPE IF EXISTS "AppointmentType";
