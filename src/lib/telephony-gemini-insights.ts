import { z } from "zod";

const scorePartSchema = z.object({
  score: z.string().optional(),
  rationale: z.string().optional(),
});

export const telephonyGeminiInsightsSchema = z.object({
  callLogDetails: z
    .object({
      dateAndTime: z.string().optional(),
      vehicle: z.string().optional(),
      productOrService: z.string().optional(),
      priceOrQuote: z.string().optional(),
      direction: z.string().optional(),
      callResult: z.string().optional(),
    })
    .optional(),
  callSummary: z.string().optional(),
  callbackNotes: z.string().optional(),
  callScore: z
    .object({
      overall: z.string().optional(),
      efficiency: scorePartSchema.optional(),
      clarity: scorePartSchema.optional(),
      customerExperience: scorePartSchema.optional(),
    })
    .optional(),
  fullTranscript: z.string().optional(),
});

export type TelephonyGeminiInsights = z.infer<typeof telephonyGeminiInsightsSchema>;

export function parseTelephonyGeminiInsights(raw: unknown): TelephonyGeminiInsights | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "string") {
    try {
      return parseTelephonyGeminiInsights(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = telephonyGeminiInsightsSchema.safeParse(raw);
  return r.success ? r.data : null;
}

export function stripGeminiJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/u, "");
  }
  return t.trim();
}
