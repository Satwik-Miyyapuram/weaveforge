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
  const getters: Array<() => AiAccessSettings> = [];
  const manager = createMcpRelayManager(({ sessionId, getSettings }) => {
    getters.push(getSettings);
    return () => { stopped.push(sessionId); };
  });

  manager.ensureRelay("session-a", "secret-a", settings);
  manager.ensureRelay("session-a", "secret-a", settings);
  manager.ensureRelay("session-b", "secret-b", settings);
  assert.deepEqual(manager.runningRelays().map((relay) => relay.sessionId), ["session-a", "session-b"]);
  assert.equal(getters.length, 2);

  const tightened: AiAccessSettings = { ...settings, readCategories: [] };
  manager.ensureRelay("session-a", "secret-a", tightened);
  assert.deepEqual(getters[0]!().readCategories, []);
  assert.deepEqual(manager.runningRelays().find((r) => r.sessionId === "session-a")?.settings.readCategories, []);

  manager.stopAllRelays();
  assert.deepEqual(stopped.sort(), ["session-a", "session-b"]);
  assert.deepEqual(manager.runningRelays(), []);
});
