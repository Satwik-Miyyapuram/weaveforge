/**
 * Add calendar days to an ISO date string (YYYY-MM-DD).
 *
 * Worked in UTC so the machine's time zone and clock changes cannot move the
 * answer by a day.
 */
export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The machine's local calendar date as YYYY-MM-DD. "Today" for a person is
 * their own date: the UTC date is already tomorrow (or still yesterday) for
 * part of every day away from Greenwich.
 */
export function localIsoDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
