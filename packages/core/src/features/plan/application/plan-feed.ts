/**
 * The plan as something outside the app can read: an iCalendar feed of
 * deadlines for a calendar to subscribe to, and a small JSON summary for home
 * screen and wallpaper widgets. Pure functions over milestones — the route that
 * serves them and the widgets that draw them own every I/O concern.
 *
 * Only dated milestones are deadlines. An undated one has nowhere to sit on a
 * calendar, so the feed leaves it out and the widget summary only counts it.
 */

import type { Milestone, MilestoneStatus } from "../domain/milestone.js";

/** A milestone with the name of the project it belongs to, for display. */
export interface FeedMilestone {
  milestone: Milestone;
  projectName?: string;
}

export interface PlanFeedOptions {
  /** Keep finished milestones in the feed. Off by default: a done deadline is noise. */
  includeDone?: boolean;
  /** Add a reminder this many days before each deadline. Omitted or 0: none. */
  reminderDays?: number;
  /** When the feed is built; stamps every event. */
  now: Date;
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `yyyy-mm-dd` → a real calendar date, or null for anything else. */
function parseDate(value: string | undefined): Date | null {
  const m = value ? DATE_ONLY.exec(value) : null;
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  // Rejects 2026-02-31 and friends, which Date.UTC would roll into March.
  return date.getUTCMonth() === Number(m[2]) - 1 ? date : null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The deadlines a feed carries, soonest first. */
function deadlines(items: readonly FeedMilestone[], includeDone: boolean) {
  return items
    .map((item) => ({ ...item, date: parseDate(item.milestone.targetDate) }))
    .filter((item): item is FeedMilestone & { date: Date } =>
      item.date !== null && (includeDone || item.milestone.status !== "done"))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.milestone.id.localeCompare(b.milestone.id));
}

// ── iCalendar (RFC 5545) ─────────────────────────────────────────────────────

/** TEXT escaping: backslash, semicolon, comma and line breaks. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * Folds a content line at 75 octets, as RFC 5545 §3.1 asks, never splitting a
 * UTF-8 sequence: continuation lines start with one space, which counts
 * towards their own 75.
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = utf8Length(char.codePointAt(0)!);
    const limit = parts.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function icsStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
}

function icsDay(date: Date): string {
  return isoDay(date).replace(/-/g, "");
}

const STATUS_PREFIX: Record<MilestoneStatus, string> = {
  planned: "⚑",
  in_progress: "⚑",
  blocked: "⚑ Blocked:",
  done: "✓",
};

/**
 * The deadlines as an iCalendar document a calendar app can subscribe to.
 *
 * Each dated milestone is one all-day event on its target date. The UID is the
 * milestone id, so moving a deadline moves the event rather than adding a
 * second one.
 */
export function milestonesToIcs(items: readonly FeedMilestone[], options: PlanFeedOptions): string {
  const stamp = icsStamp(options.now);
  const reminder = Math.max(0, Math.floor(options.reminderDays ?? 0));
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//WeaveForge//Plan deadlines//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:WeaveForge deadlines",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const { milestone, projectName, date } of deadlines(items, options.includeDone ?? false)) {
    const next = new Date(date.getTime() + 86_400_000);
    const summary = `${STATUS_PREFIX[milestone.status]} ${milestone.title}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${milestone.id}@weaveforge.org`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDay(date)}`,
      `DTEND;VALUE=DATE:${icsDay(next)}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      "TRANSP:TRANSPARENT",
    );
    if (milestone.description?.trim()) lines.push(`DESCRIPTION:${escapeIcsText(milestone.description.trim())}`);
    if (projectName?.trim()) lines.push(`CATEGORIES:${escapeIcsText(projectName.trim())}`);
    if (reminder > 0 && milestone.status !== "done") {
      lines.push(
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        `DESCRIPTION:${escapeIcsText(milestone.title)}`,
        `TRIGGER:-P${reminder}D`,
        "END:VALARM",
      );
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

// ── Widget summary ───────────────────────────────────────────────────────────

export interface PlanWidgetItem {
  id: string;
  title: string;
  project: string | null;
  /** `yyyy-mm-dd`. */
  date: string;
  status: MilestoneStatus;
  /** Whole days from `today` to `date`; negative when overdue. */
  daysLeft: number;
}

export interface PlanWidgetData {
  version: 1;
  generatedAt: string;
  /** The UTC day `daysLeft` counts from. A widget may recount in its own zone. */
  today: string;
  items: PlanWidgetItem[];
  overdue: number;
  /** Open milestones with no date: not on any calendar, still on the plan. */
  undated: number;
}

/** The deadlines a widget draws, soonest first, overdue ones included. */
export function planWidgetData(
  items: readonly FeedMilestone[],
  options: PlanFeedOptions & { limit?: number },
): PlanWidgetData {
  const today = parseDate(isoDay(options.now))!;
  const dated = deadlines(items, options.includeDone ?? false).map(({ milestone, projectName, date }) => ({
    id: milestone.id,
    title: milestone.title,
    project: projectName?.trim() || null,
    date: isoDay(date),
    status: milestone.status,
    daysLeft: Math.round((date.getTime() - today.getTime()) / 86_400_000),
  }));
  return {
    version: 1,
    generatedAt: options.now.toISOString(),
    today: isoDay(today),
    items: dated.slice(0, Math.max(1, options.limit ?? 20)),
    overdue: dated.filter((item) => item.daysLeft < 0 && item.status !== "done").length,
    undated: items.filter((item) => !parseDate(item.milestone.targetDate) && item.milestone.status !== "done").length,
  };
}
