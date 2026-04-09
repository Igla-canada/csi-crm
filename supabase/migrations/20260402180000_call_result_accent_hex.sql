-- Optional exact color override (still keep accentKey for preset fallback + labels)
ALTER TABLE "CallResultOption" ADD COLUMN IF NOT EXISTS "accentHex" TEXT NULL;
