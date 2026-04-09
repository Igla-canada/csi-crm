-- Canonical copy: supabase/migrations/20260407140000_product_service_general_only_builtin.sql

UPDATE "ProductServiceOption"
SET "isBuiltIn" = false
WHERE "code" IN ('IGLA', 'DASH_CAM');
