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
