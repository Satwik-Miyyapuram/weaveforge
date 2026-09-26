/**
 * "edited 3h ago" for a section's meta line: minutes, hours and days for the
 * last week, then the date. Returns null without a timestamp, so sections read
 * before the column existed simply show nothing.
 */
export function editedLabel(updatedAt: string | undefined, now: Date = new Date()): string | null {
  if (!updatedAt) return null;
  const then = new Date(updatedAt);
  const seconds = (now.getTime() - then.getTime()) / 1000;
  if (Number.isNaN(seconds)) return null;
  if (seconds < 60) return "edited just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `edited ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `edited ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `edited ${days}d ago`;
  return `edited ${then.toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
}
