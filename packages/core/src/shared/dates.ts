/**
 * The machine's local calendar date as YYYY-MM-DD. "Today" for a person is
 * their own date: the UTC date is already tomorrow (or still yesterday) for
 * part of every day away from Greenwich.
 */
export function localIsoDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

