-- Per-user access overrides (merged with role defaults in app). Safe to run once on existing DBs.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "privilegeOverrides" JSONB;
