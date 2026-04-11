import "server-only";

import { GoogleGenerativeAI, GoogleGenerativeAIFetchError } from "@google/generative-ai";

import { getGeminiApiKey, getGeminiTranscribeModel } from "@/lib/gemini/env";
import {
  stripGeminiJsonFence,
  telephonyGeminiInsightsSchema,
  type TelephonyGeminiInsights,
} from "@/lib/telephony-gemini-insights";

export type GeminiCallTranscriptionResult = {
  insights: TelephonyGeminiInsights;
  transcript: string;
  summary: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGeminiRateLimitError(e: unknown): boolean {
  if (e instanceof GoogleGenerativeAIFetchError && e.status === 429) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /429|resource.?exhausted|rate exceeded|too many requests|quota/i.test(msg);
}

function buildPrompt(context: {
  shopTimeZone: string;
  happenedAtIso: string;
  direction: string;
  telephonyResult: string | null;
  contactName: string | null;
  contactPhone: string | null;
}): string {
  return `You are an analyst for a vehicle electronics / car-systems installation shop CRM.

Listen to this phone call recording and respond with a single JSON object only (no markdown, no code fences). Use this exact shape and keys:
{
  "callLogDetails": {
    "dateAndTime": "string — local wall time for the shop, formatted MM/DD/YYYY hh:mm AM/PM",
    "vehicle": "string or empty",
    "productOrService": "string or empty",
    "priceOrQuote": "string or empty (include currency/tax wording if mentioned)",
    "direction": "INBOUND or OUTBOUND (infer from audio/context if not obvious, else use hint below)",
    "callResult": "short outcome label e.g. Booked, Follow up, Voicemail, Missed, Information only"
  },
  "callSummary": "one clear paragraph: what happened on the call (customer intent, what staff said, outcome)",
  "callbackNotes": "one paragraph: concrete follow-up recommendations for staff",
  "callScore": {
    "overall": "e.g. 8/10",
    "efficiency": { "score": "x/10", "rationale": "..." },
    "clarity": { "score": "x/10", "rationale": "..." },
    "customerExperience": { "score": "x/10", "rationale": "..." }
  },
  "fullTranscript": "full transcript of the audio, with line breaks between speakers if you can tell them apart; otherwise plain text"
}

Rules:
- If you cannot hear clearly, still return best-effort JSON; use empty strings where unknown.
- Shop timezone for dateAndTime: ${context.shopTimeZone}
- CRM "official" timestamp (UTC ISO): ${context.happenedAtIso} — convert to the shop timezone for dateAndTime.
- Direction hint from CRM: ${context.direction}
- Carrier / PBX result hint (may be empty): ${context.telephonyResult ?? ""}
- Caller name hint: ${context.contactName ?? ""}
- Caller phone hint: ${context.contactPhone ?? ""}
`;
}

export async function transcribeCallRecordingWithGemini(input: {
  audioBase64: string;
  mimeType: string;
  shopTimeZone: string;
  happenedAtIso: string;
  direction: string;
  telephonyResult: string | null;
  contactName: string | null;
  contactPhone: string | null;
}): Promise<GeminiCallTranscriptionResult> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const modelId = getGeminiTranscribeModel();
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const prompt = buildPrompt({
    shopTimeZone: input.shopTimeZone,
    happenedAtIso: input.happenedAtIso,
    direction: input.direction,
    telephonyResult: input.telephonyResult,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
  });

  const parts = [
    { text: prompt },
    {
      inlineData: {
        mimeType: input.mimeType,
        data: input.audioBase64,
      },
    },
  ];

  const maxAttempts = 5;
  let result: Awaited<ReturnType<typeof model.generateContent>> | undefined;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      result = await model.generateContent(parts);
      break;
    } catch (e) {
      const retryable = isGeminiRateLimitError(e) && attempt < maxAttempts - 1;
      if (!retryable) {
        throw e;
      }
      const delayMs = Math.min(45_000, 2500 * 2 ** attempt);
      await sleep(delayMs);
    }
  }
  if (!result) {
    throw new Error("Gemini transcription failed after retries.");
  }

  const text = result.response.text();
  const rawJson = stripGeminiJsonFence(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    throw new Error("Gemini returned text that is not valid JSON.");
  }

  const safe = telephonyGeminiInsightsSchema.safeParse(parsed);
  if (!safe.success) {
    throw new Error("Gemini JSON did not match the expected structure.");
  }

  const insights = safe.data;
  const transcript = (insights.fullTranscript ?? "").trim();
  const summary = (insights.callSummary ?? "").trim();
  if (!transcript && !summary) {
    throw new Error("Gemini returned empty transcript and summary.");
  }

  return {
    insights,
    transcript: transcript || summary,
    summary: summary || transcript.slice(0, 2000),
  };
}
