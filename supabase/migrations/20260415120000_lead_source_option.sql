-- Lead / "found us through" options for call logs (same pattern as BookingTypeOption, no accents).

CREATE TABLE "LeadSourceOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSourceOption_pkey" PRIMARY KEY ("code")
);

INSERT INTO "LeadSourceOption" ("code", "label", "sortOrder", "isBuiltIn", "active", "createdAt")
VALUES
  ('GOOGLE', 'Google', 10, true, true, CURRENT_TIMESTAMP),
  ('REFERRAL', 'Referral', 20, true, true, CURRENT_TIMESTAMP),
  ('WALK_IN', 'Walk-in', 30, true, true, CURRENT_TIMESTAMP),
  ('WEBSITE', 'Website', 40, true, true, CURRENT_TIMESTAMP),
  ('SOCIAL', 'Social media', 50, true, true, CURRENT_TIMESTAMP),
  ('BOOKING', 'Booking / calendar', 55, true, true, CURRENT_TIMESTAMP),
  ('OTHER', 'Other', 60, true, true, CURRENT_TIMESTAMP);
