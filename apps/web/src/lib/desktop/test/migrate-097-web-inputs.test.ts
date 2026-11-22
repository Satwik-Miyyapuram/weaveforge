/**
 * The web export's inputs: the run id is the install id that browserReportOk reads from the
 * same OPFS root, and the codec is built only once the core has loaded.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { OpfsLike } from "@/features/migration-097/infrastructure/workspace-file-sink";
import { INSTALL_ID_PATH, readOrCreateInstallId } from "@/container/browser-install-id";
import type { WebUpgradeInputs } from "@/features/migration-097/application/web-upgrade-options";
import type { WebCore, WebInputSources } from "../migrate-097-web";

// readOrCreateInstallId runs under navigator.locks; the node runner has none.
Object.defineProperty(globalThis, "navigator", {
  value: { locks: { request: (_name: string, fn: () => unknown) => Promise.resolve().then(fn) } },
  configurable: true,
});

/** A Map-backed fs with the three calls readOrCreateInstallId makes. */
function memoryFs() {
  const files = new Map<string, string>();
  const missing = () => Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  return {
    files,
    async readText(path: string): Promise<string> {
      const value = files.get(path);
      if (value === undefined) throw missing();
      return value;
    },
    async writeFile(path: string, data: string): Promise<void> {
      files.set(path, data);
    },
    async rename(from: string, to: string): Promise<void> {
      const value = files.get(from);
      if (value === undefined) throw missing();
      files.set(to, value);
      files.delete(from);
    },
  };
}

type Fs = ReturnType<typeof memoryFs>;

function sources(fs: Fs, overrides: Partial<WebInputSources> = {}): WebInputSources {
  return {
    loadCore: async () => ({}) as WebCore,
    makeCodec: () => ({}) as WebUpgradeInputs["codec"],
    openFs: async () => fs as unknown as OpfsLike,
    session: async () => ({
      userId: "user-1",
      baseUrl: "https://api.test/rest/v1",
      anonKey: "anon",
      accessToken: async () => "token",
    }),
    ...overrides,
  };
}

test("the web run id is the install id browserReportOk reads from the same OPFS root", async () => {
  const fs = memoryFs();
  const { loadWebInputs } = await import("../migrate-097-web");
  const inputs = await loadWebInputs(sources(fs));
  assert.ok(inputs, "a signed-in session gives inputs");
  assert.equal(inputs.runDeviceId, await readOrCreateInstallId(fs), "same id the report check reads");
  assert.equal(fs.files.has(INSTALL_ID_PATH), true, "the id lives in the OPFS install-id file");
});

test("the codec is never built before the core has loaded", async () => {
  const fs = memoryFs();
  const { loadWebInputs } = await import("../migrate-097-web");
  let releaseCore!: (core: WebCore) => void;
  const core = new Promise<WebCore>((resolve) => {
    releaseCore = resolve;
  });
  let codecs = 0;
  const pending = loadWebInputs(
    sources(fs, {
      loadCore: () => core,
      makeCodec: () => {
        codecs += 1;
        return {} as WebUpgradeInputs["codec"];
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(codecs, 0, "no codec while the core is still loading");
  releaseCore({} as WebCore);
  await pending;
  assert.equal(codecs, 1, "the codec is built once the core resolves");
});
