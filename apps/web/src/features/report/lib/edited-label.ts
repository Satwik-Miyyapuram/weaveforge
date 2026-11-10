/**
 * "edited 3h ago" for a section's meta line: minutes, hours and days for the
 * last week, then the date. Returns null without a timestamp, so sections read
 * before the column existed simply show nothing.
 */
import { readyCore } from "@/lib/rust-core";

export function editedLabel(updatedAt: string | undefined, now: Date = new Date()): string | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt);
  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (Number.isNaN(seconds)) return null;
  const relative = readyCore().editedRelativeLabel(seconds);
  if (relative != null) return relative;
  // The date form depends on the reader's locale, so it stays in JS.
  return `edited ${then.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
