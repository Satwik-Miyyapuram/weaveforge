import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopShim, type DesktopCommands } from "../desktop";

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

const error = (message: string): Reply => ({
  status: "error",
  error: { message },
});

test("readVaultBytes decodes base64 into a Uint8Array", async () => {
  const { cmds } = fakeCommands({
    vaultReadBytes: { status: "ok", data: "AP8BAg==" },
  });
  const bytes = await desktopShim(cmds).readVaultBytes("a.bin");
  assert.deepEqual(bytes, new Uint8Array([0, 255, 1, 2]));
});

test("readVaultBytes gives null when the file is missing", async () => {
  const { cmds } = fakeCommands();
  assert.equal(await desktopShim(cmds).readVaultBytes("a.bin"), null);
});

test("writeVaultBytes sends the bytes as base64", async () => {
  const { cmds, calls } = fakeCommands();
  await desktopShim(cmds).writeVaultBytes(
    "a.bin",
    new Uint8Array([0, 255, 1, 2]),
  );
  assert.deepEqual(calls, [
    { cmd: "vaultWriteBytes", args: ["a.bin", "AP8BAg=="] },
  ]);
});

test("listVaultFiles passes null when no path is given, and the path otherwise", async () => {
  const { cmds, calls } = fakeCommands();
  const shim = desktopShim(cmds);
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
  const shim = desktopShim(cmds);
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

test("fetchImage gives an exact ArrayBuffer of the decoded bytes", async () => {
  const { cmds } = fakeCommands({
    fetchImage: {
      status: "ok",
      data: { bytes: "AQID", contentType: "image/png", url: "https://x/y.png" },
    },
  });
  const image = await desktopShim(cmds).fetchImage("https://x/y.png");
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
  const result = await desktopShim(cmds).compileTex([], "main.tex");
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
  const result = await desktopShim(cmds).compileTex([], "main.tex");
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
  await desktopShim(cmds).compileTex(files, "main.tex");
  assert.equal(calls.length, 1);
  const [sentFiles, sentEntry] = calls[0]!.args;
  assert.ok(Array.isArray(sentFiles));
  assert.notEqual(sentFiles, files);
  assert.deepEqual(sentFiles, files);
  assert.equal(sentEntry, "main.tex");
});

test("reportAppLog returns undefined synchronously and sends detail null when missing", () => {
  const { cmds, calls } = fakeCommands();
  const result = desktopShim(cmds).reportAppLog?.({
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
  desktopShim(cmds).reportAppLog?.({
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
  desktopShim(cmds).reportAppLog?.({
    level: "error",
    source: "web",
    message: "x",
  });
  await new Promise((resolve) => setImmediate(resolve));
});

test("writeVaultFile, removeVaultFile, writePreference, writeSecret and clearSecret resolve to undefined", async () => {
  const { cmds, calls } = fakeCommands();
  const shim = desktopShim(cmds);
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
  assert.equal(await desktopShim(cmds).readSecret("git-sync-token"), "tok");
  assert.deepEqual(calls, [{ cmd: "secretRead", args: ["git-sync-token"] }]);
});

test("vaultLog passes the limit", async () => {
  const { cmds, calls } = fakeCommands();
  await desktopShim(cmds).vaultLog(5);
  assert.deepEqual(calls, [{ cmd: "vaultLog", args: [5] }]);
});

test("vaultSync passes the action", async () => {
  const { cmds, calls } = fakeCommands();
  await desktopShim(cmds).vaultSync?.("pull");
  assert.deepEqual(calls, [{ cmd: "vaultSync", args: ["pull"] }]);
});
