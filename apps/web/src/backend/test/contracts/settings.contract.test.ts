// contract-repos: user_settings, dashboardLayout, graphSettings
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_GRAPH_PERSISTED_STATE,
  type IDashboardLayoutRepository,
  type IGraphSettingsRepository,
  type ISettingsRepository,
} from "@weaveforge/core";
import { PostgrestSettingsRepository, type Secrets, type SecretsStore } from "@/features/settings/infrastructure/parts";
import { projectUserCtx, rustRepository } from "@/backend/providers/postgrest/rust-repository";
import { testDb } from "../pg-test-db";
import { clientFor, projectFor, seedProject, sessionFor, type Db } from "./harness";

/**
 * The `ISettingsRepository`, `IDashboardLayoutRepository` and
 * `IGraphSettingsRepository` contract, end to end against PGlite with the real
 * migrations and RLS. Ported from the deleted `settings-repository-contract.ts`,
 * `dashboard-layout-repository-contract.ts` and `graph-settings-repository-contract.ts`
 * suites.
 */

type UserSettingsInput = Parameters<ISettingsRepository["save"]>[0];
type DashboardLayoutInput = Parameters<IDashboardLayoutRepository["save"]>[1];
type GraphStateInput = Parameters<IGraphSettingsRepository["save"]>[1];

/** `{ lg, sm }` layout with one valid card per breakpoint, as `parse_dashboard_layout` expects. */
function dashboardLayout(cardType: string, id: string): DashboardLayoutInput {
  const card = { id, type: cardType, x: 0, y: 0, w: 1, h: 1 };
  return { lg: [card], sm: [card] } as unknown as DashboardLayoutInput;
}

/** Persists in memory so a saved `zoteroApiKey` reads back, as the sealed server store would. */
function memorySecrets(): SecretsStore {
  let stored: Secrets = {};
  return {
    load: async () => stored,
    save: async (secrets: Secrets) => {
      stored = { ...secrets };
    },
  };
}

async function reposFor(db: Db) {
  const userId = await db.createUser();
  const projectId = await seedProject(db, userId);
  const client = clientFor(db, userId);
  const session = sessionFor(userId);
  const settings = new PostgrestSettingsRepository(client, session, memorySecrets());
  const dashboard = rustRepository<IDashboardLayoutRepository>(
    client,
    "dashboardLayout",
    ["get", "save"],
    projectUserCtx(projectFor(projectId), session),
  );
  const graph = rustRepository<IGraphSettingsRepository>(
    client,
    "graphSettings",
    ["get", "save"],
    projectUserCtx(projectFor(projectId), session),
  );
  return { settings, dashboard, graph, projectId };
}

test("settings get returns defaults for a new user", async () => {
  const { settings } = await reposFor(await testDb());
  assert.ok(await settings.get());
});

test("settings save then get round-trips", async () => {
  const { settings } = await reposFor(await testDb());
  const base = await settings.get();
  const next: UserSettingsInput = { ...base, zoteroApiKey: "key-1" } as UserSettingsInput;
  await settings.save(next);
  const read = await settings.get();
  assert.equal(read.zoteroApiKey, "key-1");
});

test("settings save overwrites the previous value", async () => {
  const { settings } = await reposFor(await testDb());
  const base = await settings.get();
  await settings.save({ ...base, zoteroApiKey: "key-1" } as UserSettingsInput);
  await settings.save({ ...base, zoteroApiKey: "key-2" } as UserSettingsInput);
  assert.equal((await settings.get()).zoteroApiKey, "key-2");
});

test("dashboardLayout get returns null when absent", async () => {
  const { dashboard, projectId } = await reposFor(await testDb());
  assert.equal(await dashboard.get(projectId), null);
});

test("dashboardLayout save then get round-trips", async () => {
  const { dashboard, projectId } = await reposFor(await testDb());
  const layout = dashboardLayout("recent-log", "a");
  await dashboard.save(projectId, layout);
  assert.deepEqual(await dashboard.get(projectId), layout);
});

test("dashboardLayout save overwrites the previous layout", async () => {
  const { dashboard, projectId } = await reposFor(await testDb());
  const first = dashboardLayout("recent-log", "a");
  const second = dashboardLayout("recent-log", "b");
  await dashboard.save(projectId, first);
  await dashboard.save(projectId, second);
  assert.deepEqual(await dashboard.get(projectId), second);
});

test("graphSettings get returns null when absent", async () => {
  const { graph, projectId } = await reposFor(await testDb());
  assert.equal(await graph.get(projectId), null);
});

test("graphSettings save then get round-trips", async () => {
  const { graph, projectId } = await reposFor(await testDb());
  const state = DEFAULT_GRAPH_PERSISTED_STATE as unknown as GraphStateInput;
  await graph.save(projectId, state);
  assert.deepEqual(await graph.get(projectId), state);
});

test("graphSettings save overwrites the previous state", async () => {
  const { graph, projectId } = await reposFor(await testDb());
  const first = DEFAULT_GRAPH_PERSISTED_STATE as unknown as GraphStateInput;
  const second = { ...first, localDepth: first.localDepth + 1 } as GraphStateInput;
  await graph.save(projectId, first);
  await graph.save(projectId, second);
  assert.deepEqual(await graph.get(projectId), second);
});
