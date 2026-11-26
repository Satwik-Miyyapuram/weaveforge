/**
 * Files mode on the desktop and in the browser goes through one overlay (overlayFilesMode):
 * personal blobs land in the workspace files and never reach the server, and a personal
 * database write is refused the same way on both.
 *
 * The blob tests run as the shipped app does: NEXT_PUBLIC_BLOB_PROVIDER=tiered with a `window`,
 * so the server blob store is HttpBlobStore (fetch to /api/blobs/*). Without a `window` the
 * server store is SupabaseBlobStore over the guarded client, which hides an HttpBlobStore leak.
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { IBlobStore, ICurrentUserProvider } from "@weaveforge/core";
import { MemoryWorkspaceFs } from "@core-test/memory-workspace-fs";

import type { BackendConfig } from "../../backend/parts";
import { DeviceSecretsStore } from "../../backend/providers/local/parts";
import { wirePostgrestBackend } from "../../backend/providers/postgrest/wire-postgrest-backend";
import type { VaultFileBridge } from "../../features/workspace/infrastructure/parts";
import { ExperimentArtifactStore } from "../../features/experiments/infrastructure/parts";
import { LogImageStore } from "../../features/logbook/infrastructure/parts";
import { PaperImageStore } from "../../features/papers/infrastructure/parts-1";
import { ReportImageStore } from "../../features/report/infrastructure/parts";
import { FetchingBlobStore } from "../../storage/fetching-blob-store";
import { HttpBlobStore } from "../../storage/providers/http/http-blob-store";
import { loadTestCore } from "@/lib/test/load-test-core";
import { VaultAssetStore, wireBackend, type WiredBackend } from "../parts";
import { wireDesktopFileBackend } from "../desktop-file-backend";
import { wireBrowserFiles } from "../browser-file-backend";
import { READ_ONLY_MESSAGE } from "../read-only-repositories";

before(loadTestCore);

const config = {
  provider: "postgrest",
  supabaseUrl: "http://127.0.0.1:9",
  supabaseAnonKey: "test-anon-key",
  dataUrl: "http://127.0.0.1:9",
} as BackendConfig;

const settings = { load: async () => ({}), save: async () => {} } as never;
const session = { requireUserId: async () => "u1" } as unknown as ICurrentUserProvider;

function keychainSecrets() {
  const entries = new Map<string, string>();
  return new DeviceSecretsStore(
    async () => {
      throw new Error("no local database in files mode");
    },
    {
      read: async (key) => entries.get(key) ?? null,
      write: async (key, text) => void entries.set(key, text),
      clear: async (key) => void entries.delete(key),
    },
    async () => {},
  );
}

/** The shell's vault in memory, keyed by path. */
function memoryVault() {
  const files = new Map<string, Uint8Array>();
  const bridge: VaultFileBridge = {
    readVaultFile: async (path) => (files.has(path) ? new TextDecoder().decode(files.get(path)) : null),
    writeVaultFile: async (path, contents) => void files.set(path, new TextEncoder().encode(contents)),
    readVaultBytes: async (path) => files.get(path) ?? null,
    writeVaultBytes: async (path, data) => void files.set(path, data),
    listVaultFiles: async () => [],
    statVaultFile: async (path) => {
      const data = files.get(path);
      return data ? { path, kind: "file" as const, size: data.byteLength, modifiedAt: "" } : null;
    },
    removeVaultFile: async (path) => void files.delete(path),
  };
  return { bridge, files };
}

interface Platform {
  name: string;
  wire(): Promise<{ backend: WiredBackend; read(path: string): Promise<Uint8Array | null> }>;
}

const platforms: Platform[] = [
  {
    name: "desktop",
    async wire() {
      const { bridge, files } = memoryVault();
      const backend = wireBackend(config, { projectId: null }, () => null, {
        migration: "verified",
        onDesktop: true,
        wireDesktopFileBackend: wireDesktopFileBackend(bridge, settings, keychainSecrets()),
      });
      return { backend, read: async (path) => files.get(path) ?? null };
    },
  },
  {
    name: "browser",
    async wire() {
      const fs = new MemoryWorkspaceFs();
      const backend = wireBackend(config, { projectId: null }, () => null, {
        migration: "verified",
        wireBrowserFileBackend: await wireBrowserFiles(fs),
      });
      return { backend, read: async (path) => ((await fs.stat(path)) ? fs.readFile(path) : null) };
    },
  },
];

/** Runs `fn` as the shipped browser bundle: a `window`, the tiered provider, and every request recorded. */
async function asTieredBrowser<T>(fn: (urls: string[]) => Promise<T>): Promise<T> {
  const g = globalThis as { window?: unknown };
  const hadWindow = "window" in g;
  const window = g.window;
  const provider = process.env.NEXT_PUBLIC_BLOB_PROVIDER;
  const realFetch = globalThis.fetch;
  // A signed-in session, so HttpBlobStore gets as far as fetch instead of stopping at "Not authenticated."
  const proto = HttpBlobStore.prototype as unknown as { authHeaders: () => Promise<HeadersInit> };
  const realAuth = proto.authHeaders;
  proto.authHeaders = async () => ({ Authorization: "Bearer test" });
  const urls: string[] = [];
  g.window = globalThis;
  process.env.NEXT_PUBLIC_BLOB_PROVIDER = "tiered";
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    urls.push(input instanceof Request ? input.url : String(input));
    throw new Error("network refused in test");
  }) as typeof fetch;
  try {
    return await fn(urls);
  } finally {
    globalThis.fetch = realFetch;
    proto.authHeaders = realAuth;
    if (provider === undefined) delete process.env.NEXT_PUBLIC_BLOB_PROVIDER;
    else process.env.NEXT_PUBLIC_BLOB_PROVIDER = provider;
    if (hadWindow) g.window = window;
    else delete g.window;
  }
}

const blobRoutes = (urls: string[]) => urls.filter((u) => u.includes("/api/blobs/"));

test("control: the tiered server blob store under files mode does call /api/blobs/upload", async () => {
  await asTieredBrowser(async (urls) => {
    const postgrest = wirePostgrestBackend(config, { projectId: null }, () => null, undefined, { filesMode: true });
    try {
      await assert.rejects(postgrest.rawBlobStore.upload("paper-images", "u1/p1/x.png", new Blob(["x"]), "image/png"));
      assert.ok(blobRoutes(urls).some((u) => u.includes("/api/blobs/upload")), "the spy must see the upload route");
    } finally {
      postgrest.dispose();
    }
  });
});

/** Each app store as the container builds it (create-app-container.ts): over FetchingBlobStore(rawBlobStore). */
interface Store {
  name: string;
  upload(blobs: IBlobStore, bytes: Blob): Promise<string>;
  remove(blobs: IBlobStore, path: string): Promise<void>;
}

const imageStores = {
  "vault-assets": VaultAssetStore,
  "paper-images": PaperImageStore,
  "report-images": ReportImageStore,
  "log-images": LogImageStore,
} as const;

/** A server bucket's folder under assets/, as the upgrade wrote it (BlobScheme::scope). */
const folderOf: Record<string, string> = { "vault-assets": "notes", "paper-images": "papers", "report-images": "report" };

const stores: Store[] = [
  ...Object.entries(imageStores).map(([name, Ctor]) => ({
    name,
    upload: (blobs: IBlobStore, bytes: Blob) => new Ctor(new FetchingBlobStore(blobs), session).upload("owner-1", bytes, "png"),
    remove: (blobs: IBlobStore, path: string) => new Ctor(new FetchingBlobStore(blobs), session).remove(path),
  })),
  {
    name: "experiment-artifacts",
    upload: (blobs, bytes) =>
      new ExperimentArtifactStore(new FetchingBlobStore(blobs), session).upload("exp-1", new File([bytes], "loss.png", { type: "image/png" })),
    // The artifact store has no remove of its own; a delete reaches the raw store's remove.
    remove: (blobs, path) => blobs.remove("experiment-artifacts", path),
  },
];

for (const platform of platforms) {
  for (const store of stores) {
    test(`${platform.name}: a ${store.name} write lands in the workspace files and its remove stays local`, async () => {
      await asTieredBrowser(async (urls) => {
        const { backend, read } = await platform.wire();
        try {
          const bytes = new TextEncoder().encode(`${platform.name}-${store.name}`);
          const path = await store.upload(backend.rawBlobStore, new Blob([bytes], { type: "image/png" }));
          const file = `assets/${folderOf[store.name] ?? store.name}/${path}`;
          assert.deepEqual(await read(file), bytes);
          await store.remove(backend.rawBlobStore, path);
          assert.equal(await read(file), null);
          assert.deepEqual(blobRoutes(urls), [], "no request to /api/blobs/* (upload or remove)");
        } finally {
          backend.dispose();
        }
      });
    });
  }

  test(`${platform.name}: a personal database write is refused before any request`, async () => {
    const { backend } = await platform.wire();
    try {
      assert.throws(() => backend.db.from("papers").insert({ id: "p-1" }), { message: READ_ONLY_MESSAGE });
      assert.throws(() => backend.db.from("papers").upsert({ id: "p-1" }), { message: READ_ONLY_MESSAGE });
      assert.throws(() => backend.db.rpc("save_paper_bundle", {}), { message: READ_ONLY_MESSAGE });
      assert.doesNotThrow(() => backend.db.from("shares").insert({ id: "s-1" }), "org share rows stay writable");
    } finally {
      backend.dispose();
    }
  });
}
