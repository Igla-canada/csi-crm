-- Built-in call result for RingCentral (and other) telephony imports — not a follow-up queue item.
INSERT INTO "CallResultOption" ("code", "label", "sortOrder", "isBuiltIn", "active", "accentKey", "accentHex", "createdAt")
VALUES ('ARCHIVED', 'Archived', 65, true, true, 'slate', NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
