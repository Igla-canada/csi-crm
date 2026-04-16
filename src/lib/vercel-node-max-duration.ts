/**
 * Vercel Node serverless max duration (seconds). Match the project **Settings → Functions →
 * Function Max Duration** (Pro/Enterprise allows up to 800). Hobby max is 300 — set the
 * dashboard lower on Hobby or this export will be clamped by the platform.
 */
export const VERCEL_NODE_MAX_DURATION_SECONDS = 800;
