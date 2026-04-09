-- Only GENERAL stays built-in; starter rows IGLA / DASH_CAM are normal (user-managed) entries.

UPDATE "ProductServiceOption"
SET "isBuiltIn" = false
WHERE "code" IN ('IGLA', 'DASH_CAM');
