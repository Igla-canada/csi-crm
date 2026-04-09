-- Configurable products/services for call logs, imports, and reporting (codes stored on CallLog / Opportunity).

CREATE TABLE IF NOT EXISTS "ProductServiceOption" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "matchTerms" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductServiceOption_pkey" PRIMARY KEY ("code")
);

INSERT INTO "ProductServiceOption" ("code", "label", "matchTerms", "sortOrder", "isBuiltIn", "active", "createdAt")
VALUES
    ('GENERAL', 'General', 'general,general inquiry,inquiry', 5, true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
