import { test } from "node:test";
import assert from "node:assert/strict";
import { CHANNELS } from "../src/channels";
import type { IpcSurface } from "../src/ipc-guard";
import { registerMainTex } from "../src/main-tex";
import type { TexTool } from "../src/tex";

type Reply = { ok: boolean; value?: unknown; message?: string };

/** The handlers registerMainTex installs, callable without Electron. */
function handlersFor(probe: () => Promise<TexTool | null>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipc: IpcSurface = {
    handle: (channel, listener) => void handlers.set(channel, (...args) => listener({} as never, ...args)),
    on: () => undefined,
  };
  registerMainTex({ ipc, probe });
  return (channel: string, ...args: unknown[]) => handlers.get(channel)!(...args) as Promise<Reply>;
}

test("tex probe: a probe that throws answers ok:false, never a raw rejection (xipc-10)", async () => {
  const call = handlersFor(async () => { throw new Error("spawn EPERM"); });
  const reply = await call(CHANNELS.texProbe);
  assert.equal(reply.ok, false);
  assert.match(reply.message ?? "", /spawn EPERM/);

  const odd = handlersFor(async () => { throw 42; });
  const oddReply = await odd(CHANNELS.texProbe);
  assert.equal(oddReply.ok, false);
  assert.match(oddReply.message ?? "", /LaTeX/);
});

test("tex probe: a found tool and no tool both answer ok", async () => {
  const tool = { engine: "tectonic", path: "/usr/bin/tectonic" } as unknown as TexTool;
  assert.deepEqual(await handlersFor(async () => tool)(CHANNELS.texProbe), { ok: true, value: tool });
  assert.deepEqual(await handlersFor(async () => null)(CHANNELS.texProbe), { ok: true, value: null });
});
