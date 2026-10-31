import { test } from "node:test";
import assert from "node:assert/strict";
import {
  desktopShim,
  type DesktopCommands,
  type DesktopEvents,
} from "../desktop";

type Reply =
  | { status: "ok"; data: unknown }
  | { status: "error"; error: { message: string } };

type Answer = Reply | (() => Promise<Reply>);

/** Fake commands that record each call. Unanswered commands return ok with null data. */
function fakeCommands(answers: Record<string, Answer> = {}) {
  const calls: { cmd: string; args: unknown[] }[] = [];
  const cmds = new Proxy(
    {},
    {
      get:
        (_target, cmd: string) =>
        async (...args: unknown[]) => {
          calls.push({ cmd, args });
          const answer = answers[cmd];
          if (typeof answer === "function") return answer();
          return answer ?? { status: "ok", data: null };
        },
    },
  ) as unknown as DesktopCommands;
  return { cmds, calls };
}

/**
 * Fake shell events. Each `listen` records its handler and resolves once `gate`
 * does; the unlisten it returns counts its own calls.
 */
function fakeEvents(gate: () => Promise<void> = async () => {}) {
  const listens: { event: string; handler: (payload: unknown) => void }[] = [];
  let unlistens = 0;
  const events: DesktopEvents = {
    listen: async (event, handler) => {
      listens.push({ event, handler });
      await gate();
      return () => {
        unlistens += 1;
      };
    },
  };
  return { events, listens, unlistenCount: () => unlistens };
}

const error = (message: string): Reply => ({
  status: "error",
  error: { message },
});

test("readVaultBytes decodes base64 into a Uint8Array", async () => {
  const { cmds } = fakeCommands({
    vaultReadBytes: { status: "ok", data: "AP8BAg==" },
  });
  const bytes = await desktopShim(cmds, fakeEvents().events).readVaultBytes(
    "a.bin",
  );
  assert.deepEqual(bytes, new Uint8Array([0, 255, 1, 2]));
});

test("readVaultBytes gives null when the file is missing", async () => {
  const { cmds } = fakeCommands();
  assert.equal(
    await desktopShim(cmds, fakeEvents().events).readVaultBytes("a.bin"),
    null,
  );
});

test("writeVaultBytes sends the bytes as base64", async () => {
  const { cmds, calls } = fakeCommands();
  await desktopShim(cmds, fakeEvents().events).writeVaultBytes(
    "a.bin",
    new Uint8Array([0, 255, 1, 2]),
  );
  assert.deepEqual(calls, [
    { cmd: "vaultWriteBytes", args: ["a.bin", "AP8BAg=="] },
  ]);
});

test("listVaultFiles passes null when no path is given, and the path otherwise", async () => {
  const { cmds, calls } = fakeCommands();
  const shim = desktopShim(cmds, fakeEvents().events);
  await shim.listVaultFiles();
  await shim.listVaultFiles("x");
  assert.deepEqual(calls, [
    { cmd: "vaultList", args: [null] },
    { cmd: "vaultList", args: ["x"] },
  ]);
});

test("an error result rejects with the command's exact message", async () => {
  const { cmds } = fakeCommands({
    vaultRead: error("no read"),
    vaultCommit: error("no commit"),
  });
  const shim = desktopShim(cmds, fakeEvents().events);
  // Thunks, so each promise exists only while its rejection is awaited.
  const calls = [() => shim.readVaultFile("a.md"), () => shim.commitVault()];
  const messages = ["no read", "no commit"];
  for (const [i, call] of calls.entries()) {
    await assert.rejects(
      call,
      (e: unknown) => e instanceof Error && e.message === messages[i],
    );
  }
});

test("chooseVaultRoot answers the folder the shell adopted", async () => {
  const adopted = { path: "C:/notes", state: "empty" };
  const { cmds, calls } = fakeCommands({
    vaultChoose: { status: "ok", data: adopted },
  });
  const shim = desktopShim(cmds, fakeEvents().events);
  assert.deepEqual(await shim.chooseVaultRoot(), adopted);
  assert.deepEqual(calls, [{ cmd: "vaultChoose", args: [] }]);
});

test("chooseVaultRoot answers null when no folder is chosen", async () => {
  const { cmds } = fakeCommands({
    vaultChoose: { status: "ok", data: null },
  });
  assert.equal(
    await desktopShim(cmds, fakeEvents().events).chooseVaultRoot(),
    null,
  );
});

test("chooseVaultRoot rejects with the shell's reason when the folder is refused", async () => {
  const { cmds } = fakeCommands({
    vaultChoose: error("That folder cannot be used."),
  });
  await assert.rejects(
    () => desktopShim(cmds, fakeEvents().events).chooseVaultRoot(),
    (e: unknown) =>
      e instanceof Error && e.message === "That folder cannot be used.",
  );
});

test("fetchImage gives an exact ArrayBuffer of the decoded bytes", async () => {
  const { cmds } = fakeCommands({
    fetchImage: {
      status: "ok",
      data: { bytes: "AQID", contentType: "image/png", url: "https://x/y.png" },
    },
  });
  const image = await desktopShim(cmds, fakeEvents().events).fetchImage(
    "https://x/y.png",
  );
  assert.ok(image.bytes instanceof ArrayBuffer);
  assert.equal(image.bytes.byteLength, 3);
  assert.deepEqual(new Uint8Array(image.bytes), new Uint8Array([1, 2, 3]));
  assert.equal(image.contentType, "image/png");
  assert.equal(image.url, "https://x/y.png");
});

test("compileTex decodes the pdf into an ArrayBuffer", async () => {
  const { cmds } = fakeCommands({
    texCompile: {
      status: "ok",
      data: {
        ok: true,
        pdf: "JVBERg==",
        log: "",
        errors: [],
        engine: "pdflatex",
      },
    },
  });
  const result = await desktopShim(cmds, fakeEvents().events).compileTex(
    [],
    "main.tex",
  );
  if (!(result.pdf instanceof ArrayBuffer)) throw new Error("pdf missing");
  assert.deepEqual(
    new Uint8Array(result.pdf),
    new Uint8Array([37, 80, 68, 70]),
  );
});

test("compileTex keeps a null pdf as null", async () => {
  const { cmds } = fakeCommands({
    texCompile: {
      status: "ok",
      data: { ok: false, pdf: null, log: "", errors: [], engine: null },
    },
  });
  const result = await desktopShim(cmds, fakeEvents().events).compileTex(
    [],
    "main.tex",
  );
  assert.equal(result.pdf, null);
});

test("compileTex sends a plain array copy of the files and the entry file", async () => {
  const { cmds, calls } = fakeCommands({
    texCompile: {
      status: "ok",
      data: { ok: false, pdf: null, log: "", errors: [], engine: null },
    },
  });
  const files = [{ path: "main.tex", content: "\\documentclass{article}" }];
  await desktopShim(cmds, fakeEvents().events).compileTex(files, "main.tex");
  assert.equal(calls.length, 1);
  const [sentFiles, sentEntry] = calls[0]!.args;
  assert.ok(Array.isArray(sentFiles));
  assert.notEqual(sentFiles, files);
  assert.deepEqual(sentFiles, files);
  assert.equal(sentEntry, "main.tex");
});

test("reportAppLog returns undefined synchronously and sends detail null when missing", () => {
  const { cmds, calls } = fakeCommands();
  const result = desktopShim(cmds, fakeEvents().events).reportAppLog?.({
    level: "warn",
    source: "web",
    message: "hi",
  });
  assert.equal(result, undefined);
  assert.deepEqual(calls, [
    {
      cmd: "appLogReport",
      args: [{ level: "warn", source: "web", message: "hi", detail: null }],
    },
  ]);
});

test("reportAppLog does not throw or leave a rejection when the result is an error", async () => {
  const { cmds } = fakeCommands({ appLogReport: error("disk full") });
  desktopShim(cmds, fakeEvents().events).reportAppLog?.({
    level: "error",
    source: "web",
    message: "x",
    detail: "y",
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test("reportAppLog does not leave a rejection when the promise rejects", async () => {
  const { cmds } = fakeCommands({
    appLogReport: () => Promise.reject(new Error("ipc down")),
  });
  desktopShim(cmds, fakeEvents().events).reportAppLog?.({
    level: "error",
    source: "web",
    message: "x",
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test("writeVaultFile, removeVaultFile, writePreference, writeSecret and clearSecret resolve to undefined", async () => {
  const { cmds, calls } = fakeCommands();
  const shim = desktopShim(cmds, fakeEvents().events);
  assert.equal(await shim.writeVaultFile("a.md", "x"), undefined);
  assert.equal(await shim.removeVaultFile("a.md"), undefined);
  assert.equal(await shim.writePreference("vault-git", true), undefined);
  assert.equal(await shim.writeSecret("git-sync-token", "t"), undefined);
  assert.equal(await shim.clearSecret("git-sync-token"), undefined);
  assert.deepEqual(
    calls.map((c) => c.cmd),
    [
      "vaultWrite",
      "vaultRemove",
      "preferenceWrite",
      "secretWrite",
      "secretClear",
    ],
  );
});

test("readSecret passes the name", async () => {
  const { cmds, calls } = fakeCommands({
    secretRead: { status: "ok", data: "tok" },
  });
  assert.equal(
    await desktopShim(cmds, fakeEvents().events).readSecret("git-sync-token"),
    "tok",
  );
  assert.deepEqual(calls, [{ cmd: "secretRead", args: ["git-sync-token"] }]);
});

test("vaultLog passes the limit", async () => {
  const { cmds, calls } = fakeCommands();
  await desktopShim(cmds, fakeEvents().events).vaultLog(5);
  assert.deepEqual(calls, [{ cmd: "vaultLog", args: [5] }]);
});

test("vaultSync passes the action", async () => {
  const { cmds, calls } = fakeCommands();
  await desktopShim(cmds, fakeEvents().events).vaultSync?.("pull");
  assert.deepEqual(calls, [{ cmd: "vaultSync", args: ["pull"] }]);
});

test("onVaultChange listens to vault-changed and passes string paths on", () => {
  const { cmds } = fakeCommands();
  const fake = fakeEvents();
  const seen: string[][] = [];
  desktopShim(cmds, fake.events).onVaultChange((paths) => seen.push(paths));
  assert.deepEqual(
    fake.listens.map((l) => l.event),
    ["vault-changed"],
  );
  fake.listens[0]!.handler(["a.md", "b/c.md"]);
  assert.deepEqual(seen, [["a.md", "b/c.md"]]);
});

test("onVaultChange drops non-string items and skips an empty batch", () => {
  const { cmds } = fakeCommands();
  const fake = fakeEvents();
  const seen: string[][] = [];
  desktopShim(cmds, fake.events).onVaultChange((paths) => seen.push(paths));
  const handler = fake.listens[0]!.handler;
  handler(["a.md", 3, null]);
  handler([1]);
  handler("x");
  assert.deepEqual(seen, [["a.md"]]);
});

test("stopping onVaultChange calls the unlisten once", async () => {
  const { cmds } = fakeCommands();
  const fake = fakeEvents();
  const stop = desktopShim(cmds, fake.events).onVaultChange(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  stop();
  assert.equal(fake.unlistenCount(), 1);
});

test("stopping before listen resolves unlistens on arrival and never calls back", async () => {
  const { cmds } = fakeCommands();
  let open: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  const fake = fakeEvents(() => gate);
  const seen: string[][] = [];
  const stop = desktopShim(cmds, fake.events).onVaultChange((paths) =>
    seen.push(paths),
  );
  stop();
  open();
  await new Promise((resolve) => setImmediate(resolve));
  fake.listens[0]!.handler(["a.md"]);
  assert.deepEqual(seen, []);
  assert.equal(fake.unlistenCount(), 1);
});

test("a rejected listen leaves onVaultChange harmless", async () => {
  const { cmds } = fakeCommands();
  const fake = fakeEvents(() => Promise.reject(new Error("no event bus")));
  const stop = desktopShim(cmds, fake.events).onVaultChange(() => {});
  await new Promise((resolve) => setImmediate(resolve));
  assert.doesNotThrow(() => stop());
  assert.equal(fake.unlistenCount(), 0);
});

test("inkAvailable answers false when the shell errors", async () => {
  const { cmds } = fakeCommands({ inkAvailable: error("no helper") });
  assert.equal(
    await desktopShim(cmds, fakeEvents().events).inkAvailable(),
    false,
  );
});

test("inkHapticsAvailable answers false when the shell errors", async () => {
  const { cmds } = fakeCommands({ inkHapticsAvailable: error("no api") });
  assert.equal(
    await desktopShim(cmds, fakeEvents().events).inkHapticsAvailable(),
    false,
  );
});

test("inkRecognise sends null for a missing vocabulary and lang", async () => {
  const { cmds, calls } = fakeCommands({
    inkRecognise: {
      status: "ok",
      data: { engine: "os", lines: [], ms: 3 },
    },
  });
  await desktopShim(cmds, fakeEvents().events).inkRecognise({
    lines: [{ strokes: [[1, 2, 0.5]] }],
  });
  assert.deepEqual(calls, [
    {
      cmd: "inkRecognise",
      args: [
        { lines: [{ strokes: [[1, 2, 0.5]] }], vocabulary: null, lang: null },
      ],
    },
  ]);
});

test("inkRecognise reads a null confidence and time as 0 and keeps the rest", async () => {
  const words = [{ candidates: ["hi"], known: [true], join: null }];
  const { cmds } = fakeCommands({
    inkRecognise: {
      status: "ok",
      data: {
        engine: "windows-ink@1",
        ms: null,
        lines: [
          { text: "hi", confidence: null, alternatives: ["ho"], words },
          { text: "yo", confidence: 0.5, alternatives: [], words: [] },
        ],
      },
    },
  });
  const result = await desktopShim(cmds, fakeEvents().events).inkRecognise({
    lines: [{ strokes: [[1, 2, 0]] }, { strokes: [[3, 4, 0]] }],
  });
  assert.deepEqual(result, {
    engine: "windows-ink@1",
    ms: 0,
    lines: [
      { text: "hi", confidence: 0, alternatives: ["ho"], words },
      { text: "yo", confidence: 0.5, alternatives: [], words: [] },
    ],
  });
});

test("inkRecognise rejects with the shell's message", async () => {
  const { cmds } = fakeCommands({ inkRecognise: error("helper crashed") });
  await assert.rejects(
    () =>
      desktopShim(cmds, fakeEvents().events).inkRecognise({
        lines: [{ strokes: [] }],
      }),
    (e: unknown) => e instanceof Error && e.message === "helper crashed",
  );
});

test("inkHaptics swallows a failure", async () => {
  const { cmds } = fakeCommands({
    inkHaptics: () => Promise.reject(new Error("ipc down")),
  });
  const result = desktopShim(cmds, fakeEvents().events).inkHaptics({
    type: "stop",
  });
  assert.equal(result, undefined);
  await new Promise((resolve) => setImmediate(resolve));
});

test("mattermostPost sends only the four post fields", async () => {
  const { cmds, calls } = fakeCommands({
    mattermostPost: { status: "ok", data: { status: 201, body: "" } },
  });
  const req = {
    serverUrl: "https://mm.example",
    token: "t",
    channelId: "c",
    message: "hi",
    extra: "page-only",
  };
  await desktopShim(cmds, fakeEvents().events).mattermostPost?.(req);
  assert.equal(calls.length, 1);
  const [sent] = calls[0]!.args as [Record<string, unknown>];
  assert.deepEqual(Object.keys(sent!).sort(), [
    "channelId",
    "message",
    "serverUrl",
    "token",
  ]);
});

test("overleafSync maps each action to positional arguments", async () => {
  const { cmds, calls } = fakeCommands({
    overleafSync: { status: "ok", data: { links: [], hasToken: false } },
  });
  const shim = desktopShim(cmds, fakeEvents().events);
  await shim.overleafSync?.({ action: "list" });
  await shim.overleafSync?.({ action: "link", projectId: "p1", folder: "f" });
  await shim.overleafSync?.({ action: "link", projectId: "p2" });
  await shim.overleafSync?.({ action: "pull", projectId: "p1" });
  assert.deepEqual(calls, [
    { cmd: "overleafSync", args: ["list", null, null] },
    { cmd: "overleafSync", args: ["link", "p1", "f"] },
    { cmd: "overleafSync", args: ["link", "p2", null] },
    { cmd: "overleafSync", args: ["pull", "p1", null] },
  ]);
});

test("readOverleafProject returns the shell's source", async () => {
  const source = {
    projectId: "p1",
    entryFile: "main.tex",
    files: [{ path: "main.tex", content: "x" }],
    overleafUrl: "https://www.overleaf.com/project/p1",
  };
  const { cmds, calls } = fakeCommands({
    overleafRead: { status: "ok", data: source },
  });
  const result = await desktopShim(cmds, fakeEvents().events).readOverleafProject(
    "p1",
    "main.tex",
  );
  assert.deepEqual(result, source);
  assert.deepEqual(calls, [
    { cmd: "overleafRead", args: ["p1", "main.tex"] },
  ]);
});
