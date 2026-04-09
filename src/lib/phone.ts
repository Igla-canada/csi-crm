export function normalizePhone(value?: string | null) {
  return value?.replace(/\D/g, "") || null;
}
