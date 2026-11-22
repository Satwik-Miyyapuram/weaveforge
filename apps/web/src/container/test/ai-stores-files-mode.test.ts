import assert from "node:assert/strict";
import { before, test } from "node:test";

import type { AiWriteProposal, WorkspaceStat } from "@weaveforge/core";

import type { BackendConfig } from "../../backend/parts";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireBackend } from "../parts";
import { loadTestCore } from "@/lib/test/load-test-core";
import { READ_ONLY_MESSAGE } from "../read-only-repositories";

// The AI proposal and audit stores are personal data: in files mode they must be
// folder files, never the PostgREST tables (ai_proposals / ai_audit, archived by 0165).
before(loadTestCore);

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;

function memoryVault() {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bridge: VaultFileBridge = {
    readVaultFile: async (path) => {
      const data = files.get(path);
      return data ? decoder.decode(data) : null;
    },
    writeVaultFile: async (path, contents) => {
      files.set(path, encoder.encode(contents));
    },
    readVaultBytes: async (path) => files.get(path) ?? null,
    writeVaultBytes: async (path, data) => {
      files.set(path, data);
    },
    listVaultFiles: async (dir = "") => {
      // One level, like the real bridge: direct files, and each immediate subfolder as a dir.
      const prefix = dir === "" ? "" : `${dir}/`;
      const entries = new Map<string, WorkspaceStat>();
      for (const [path, data] of files) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const head = `${prefix}${rest.split("/")[0]}`;
        const kind = rest.includes("/") ? "dir" : "file";
        entries.set(head, { path: head, size: data.length, modifiedAt: "2026-11-22T00:00:00.000Z", kind });
      }
      return [...entries.values()];
    },
    statVaultFile: async () => null,
    removeVaultFile: async (path) => {
      files.delete(path);
    },
  };
  return { bridge, files };
}

const proposal: AiWriteProposal = {
  id: "11111111-2222-4333-8444-555555555555",
  kind: "append_paper_note",
  resourceId: "66666666-7777-4888-8999-000000000000",
  content: "MCP suggestion",
  createdAt: "2026-11-22T00:00:00.000Z",
  status: "pending",
  sourceLinks: [],
  expectedRevision: "rev-1",
};

test("in files mode an MCP suggestion is saved to the folder, never to the database", async () => {
  const { bridge, files } = memoryVault();
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  await backend.aiProposalStore.save(proposal);
  assert.ok(files.has(`.weaveforge/proposals/${proposal.id}.json`), "the proposal file was written");
});

test("in files mode an accepted AI action is counted from the folder's audit files", async () => {
  const { bridge } = memoryVault();
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "verified",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  await backend.aiAuditStore.save({
    id: "a-1",
    proposalId: proposal.id,
    action: "accepted",
    createdAt: "2026-11-22T00:00:00.000Z",
  });
  assert.equal(await backend.aiAuditStore.countAccepted(), 1);
});

test("read-only refuses an AI save and writes nothing", async () => {
  const { bridge, files } = memoryVault();
  const backend = wireBackend(config, { projectId: null }, () => null, {
    migration: "unavailable",
    onDesktop: true,
    wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings),
  });
  await assert.rejects(async () => backend.aiProposalStore.save(proposal), { message: READ_ONLY_MESSAGE });
  assert.equal(files.size, 0);
});
