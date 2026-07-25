import assert from "node:assert/strict";
import test from "node:test";
import type { AiAccessSettings } from "@thesis/core";
import { createMcpRelayManager } from "../mcp-relay-manager";

const settings: AiAccessSettings = {
  enabled: true,
  disclosureAcceptedAt: "2026-07-15T12:00:00.000Z",
  readCategories: ["paper_metadata"],
  proposalKinds: [],
};

test("relay manager starts each session once and stops every live relay on cleanup", () => {
  const stopped: string[] = [];
  const manager = createMcpRelayManager(({ sessionId }) => () => { stopped.push(sessionId); });

  manager.ensureRelay("session-a", "secret-a", settings);
  manager.ensureRelay("session-a", "secret-a", settings);
  manager.ensureRelay("session-b", "secret-b", settings);
  assert.deepEqual(manager.runningRelays().map((relay) => relay.sessionId), ["session-a", "session-b"]);

  manager.stopAllRelays();
  assert.deepEqual(stopped.sort(), ["session-a", "session-b"]);
  assert.deepEqual(manager.runningRelays(), []);
});
