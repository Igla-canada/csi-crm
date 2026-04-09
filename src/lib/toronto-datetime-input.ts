/** `datetime-local` value string in Toronto wall time (matches prior Log a Call behavior). */
export function getTorontoNowDatetimeLocalValue(): string {
  const formatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(new Date());
  const lookup = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );

  return `${lookup.year}-${lookup.month}-${lookup.day}T${lookup.hour}:${lookup.minute}`;
}
