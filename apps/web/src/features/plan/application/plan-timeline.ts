import type { Milestone, MilestoneStatus } from "@weaveforge/core";

export interface PlanTimelineMark {
  id: string;
  title: string;
  status: MilestoneStatus;
  /** Position along the track, 0–100. */
  at: number;
}

export interface PlanTimeline {
  marks: PlanTimelineMark[];
  months: { label: string; at: number }[];
  /** Where today falls on the track, 0–100. */
  today: number;
}

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function day(iso: string): number {
  return new Date(`${iso}T00:00:00`).getTime();
}

/**
 * The plan laid out in time: each dated milestone as a mark, today as a line,
 * and a handful of month ticks. The track runs from the earliest of today and
 * the first milestone to the latest of today and the last one, so today is
 * always on it. Null when no milestone has a date: there is no time to draw.
 */
export function planTimeline(milestones: readonly Milestone[], now: Date = new Date()): PlanTimeline | null {
  const dated = milestones.filter((m) => m.targetDate);
  if (dated.length === 0) return null;
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const times = dated.map((m) => day(m.targetDate!));
  const start = Math.min(todayMs, ...times);
  // A single day would divide by zero; a fortnight either side keeps it legible.
  const end = Math.max(todayMs, ...times, start + 28 * DAY);
  const at = (t: number) => Math.round(((t - start) / (end - start)) * 1000) / 10;

  const marks = dated
    .map((m) => ({ id: m.id, title: m.title, status: m.status, at: at(day(m.targetDate!)) }))
    .sort((a, b) => a.at - b.at);

  // First of each month inside the track, thinned so no more than six show.
  const firsts: number[] = [];
  const cursor = new Date(start);
  cursor.setDate(1);
  cursor.setMonth(cursor.getMonth() + 1);
  while (cursor.getTime() <= end) {
    firsts.push(cursor.getTime());
    cursor.setMonth(cursor.getMonth() + 1);
  }
  const step = Math.max(1, Math.ceil(firsts.length / 6));
  const months = firsts
    .filter((_, i) => i % step === 0)
    .map((t) => ({ label: MONTHS[new Date(t).getMonth()] ?? "", at: at(t) }));

  return { marks, months, today: at(todayMs) };
}

/** "on track", or how many are overdue, then how many fall due within two weeks. */
export function planPace(milestones: readonly Milestone[], now: Date = new Date()): string {
  const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  let overdue = 0;
  let soon = 0;
  for (const m of milestones) {
    if (!m.targetDate || m.status === "done") continue;
    const days = Math.round((day(m.targetDate) - todayMs) / DAY);
    if (days < 0) overdue++;
    else if (days <= 14) soon++;
  }
  const parts = [overdue > 0 ? `${overdue} overdue` : "on track"];
  if (soon > 0) parts.push(`${soon} due soon`);
  return parts.join(" · ");
}
