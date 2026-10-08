import assert from "node:assert/strict";
import test from "node:test";
import type { LogEntry, Milestone } from "@weaveforge/core";
import { MattermostNotifier } from "../infrastructure/mattermost-notifier";
import { mattermostChannelFor } from "../domain/mattermost-options";
import type { Integration } from "../domain/integration";
import type { IIntegrationsStore } from "../domain/sync-ports";
import { MattermostNotificationIntegration } from "@/integrations/providers/mattermost/notification-integration";

const base: Integration = { provider: "mattermost", enabled: true, token: "t", repo: "https://chat.example.com", branch: "main-ch" };

function harness(integration: Integration) {
  const posts: { channel: string; message: string }[] = [];
  const notifier = new MattermostNotifier(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { channel_id: string; message: string };
    posts.push({ channel: body.channel_id, message: body.message });
    return new Response("{}", { status: 201 });
  });
  const store: IIntegrationsStore = { get: async () => integration, save: async () => {} };
  const mm = new MattermostNotificationIntegration({ projectId: () => "p1", integrations: store, notifier });
  return { mm, posts };
}

const log = (kind: "daily" | "weekly"): LogEntry =>
  ({ id: "l1", entryDate: "2026-10-02", kind, body: "Ran the ablation.", links: [], createdAt: "" });
const milestone = { title: "Draft ch. 2", status: "done", targetDate: null, compute: [], dependencies: [] } as unknown as Milestone;

test("a linked channel with no events switched on posts nothing", async () => {
  const { mm, posts } = harness(base);
  await mm.notifyLogEntry(log("daily"));
  await mm.notifyMilestone("added", milestone);
  await mm.notifyMilestone("status", milestone);
  assert.equal(posts.length, 0);
});

test("only the switched-on events post", async () => {
  const { mm, posts } = harness({ ...base, options: { events: { dailyLogs: true } } });
  await mm.notifyLogEntry(log("daily"));
  await mm.notifyLogEntry(log("weekly"));
  await mm.notifyMilestone("added", milestone);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.channel, "main-ch");
  assert.match(posts[0]?.message ?? "", /Daily log — 2026-10-02\*\*\nRan the ablation\./);
});

test("per-event channels route each event, blank falls back to the default", async () => {
  const integration: Integration = {
    ...base,
    options: {
      sameChannel: false,
      events: { dailyLogs: true, milestoneStatus: true, milestoneAdded: true },
      channels: { dailyLogs: "logs-ch", milestoneStatus: "plan-ch", milestoneAdded: "  " },
    },
  };
  const { mm, posts } = harness(integration);
  await mm.notifyLogEntry(log("daily"));
  await mm.notifyMilestone("status", milestone);
  await mm.notifyMilestone("added", milestone);
  assert.deepEqual(posts.map((p) => p.channel), ["logs-ch", "plan-ch", "main-ch"]);
});

test("same-channel mode ignores per-event channels", () => {
  const i: Integration = { ...base, options: { sameChannel: true, events: { dailyLogs: true }, channels: { dailyLogs: "logs-ch" } } };
  assert.equal(mattermostChannelFor(i, "dailyLogs"), "main-ch");
});

test("in the desktop app the shell sends the post, so the server needs no CORS rule", async () => {
  const sent: unknown[] = [];
  const g = globalThis as { window?: unknown };
  const before = g.window;
  g.window = {
    weaveforge: {
      fetchTitle: () => {},
      mattermostPost: async (req: unknown) => (sent.push(req), { status: sent.length === 1 ? 201 : 403, body: "denied" }),
    },
  };
  try {
    await new MattermostNotifier().post(base, "hello");
    assert.deepEqual(sent[0], { serverUrl: "https://chat.example.com", token: "t", channelId: "main-ch", message: "hello" });
    await assert.rejects(new MattermostNotifier().post(base, "again"), /failed \(403\)\. denied/);
  } finally {
    g.window = before;
  }
});
