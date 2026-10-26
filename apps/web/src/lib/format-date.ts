/**
 * One date format in the UI (D12, D-01): "1 Jul 2026", "1 Jul 2026, 14:05",
 * and "2h ago" for activity under a week old. ISO stays for inputs and exports.
 */

type DateInput = string | number | Date | null | undefined;

function parse(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  // A bare "YYYY-MM-DD" is a calendar day, not UTC midnight (which is the day
  // before west of Greenwich).
  const day = typeof input === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(input) as [string, string, string, string] | null : null;
  const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });

export function formatDate(input: DateInput): string {
  const d = parse(input);
  // "Sept" in some ICU builds; the UI says "Sep".
  return d ? DATE.format(d).replace("Sept", "Sep") : "";
}

export function formatDateTime(input: DateInput): string {
  const d = parse(input);
  return d ? `${formatDate(d)}, ${TIME.format(d)}` : "";
}

export function formatRelative(input: DateInput, now: Date = new Date()): string {
  const d = parse(input);
  if (!d) return "";
  const seconds = (now.getTime() - d.getTime()) / 1000;
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 7 * 86400) return `${Math.floor(seconds / 86400)}d ago`;
  return formatDate(d);
}
