/**
 * Matches server-side {@link telephonyResultLooksResolvedNotMissed} in crm.ts — when true, the call is
 * missed, voicemail, no-answer, or similar (for call-history UI icons).
 */
export function telephonyResultLooksMissedOrUnanswered(label: string | null | undefined): boolean {
  if (!label?.trim()) return false;
  const norm = label.toLowerCase();
  if (norm.includes("missed")) return true;
  if (norm.includes("voicemail") || norm.includes("voice mail")) return true;
  if (norm.includes("no answer") || norm.includes("noanswer")) return true;
  if (norm.includes("busy") && !norm.includes("connected")) return true;
  return false;
}
