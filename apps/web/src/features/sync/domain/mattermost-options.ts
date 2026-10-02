import type { Integration } from "./integration";

/** Every kind of post the app can send to Mattermost. */
export type MattermostEvent =
  | "milestoneAdded"
  | "milestoneStatus"
  | "citationAlerts"
  | "dailyLogs"
  | "weeklyLogs";

export const MATTERMOST_EVENTS: readonly { id: MattermostEvent; label: string; hint: string }[] = [
  { id: "dailyLogs", label: "Daily log entries", hint: "Each new daily entry you add in the logbook" },
  { id: "weeklyLogs", label: "Weekly log entries", hint: "Each new weekly entry you add in the logbook" },
  { id: "milestoneAdded", label: "New milestones", hint: "When you add a milestone on the plan" },
  { id: "milestoneStatus", label: "Milestone status changes", hint: "When a milestone moves to a new status" },
  { id: "citationAlerts", label: "New-citation alerts", hint: "When a tracked paper gets new citing papers" },
];

export interface MattermostOptions {
  /** Events that post. Anything missing is off, so linking a channel sends nothing until chosen. */
  events: Partial<Record<MattermostEvent, boolean>>;
  /** True: every event goes to the connection's channel. False: per-event channels below. */
  sameChannel: boolean;
  /** Per-event channel id, used only when `sameChannel` is false; blank falls back to the main channel. */
  channels: Partial<Record<MattermostEvent, string>>;
}

export function mattermostOptions(i: Integration): MattermostOptions {
  const raw = (i.options ?? {}) as Partial<MattermostOptions>;
  return {
    events: { ...(raw.events ?? {}) },
    sameChannel: raw.sameChannel !== false,
    channels: { ...(raw.channels ?? {}) },
  };
}

/** Channel this event posts to, or null when the event is switched off. */
export function mattermostChannelFor(i: Integration, event: MattermostEvent): string | null {
  const o = mattermostOptions(i);
  if (o.events[event] !== true) return null;
  const own = o.sameChannel ? "" : (o.channels[event] ?? "").trim();
  const channel = own || i.branch.trim();
  return channel || null;
}
