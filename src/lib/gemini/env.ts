import "server-only";

function trimEnv(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v === "" ? undefined : v;
}

export function getGeminiApiKey(): string | null {
  const k = trimEnv("GEMINI_API_KEY");
  return k ?? null;
}

/** Model id for `generateContent` (multimodal + audio). Default avoids deprecated 2.0 Flash for new API keys. */
export function getGeminiTranscribeModel(): string {
  return trimEnv("GEMINI_TRANSCRIBE_MODEL") ?? "gemini-2.5-flash";
}
