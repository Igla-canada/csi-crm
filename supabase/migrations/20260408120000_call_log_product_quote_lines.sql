-- Multiple product/service + price pairs per call log (JSON array of { product, priceText }).
ALTER TABLE "CallLog" ADD COLUMN IF NOT EXISTS "productQuoteLines" JSONB;
