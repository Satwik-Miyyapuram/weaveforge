/**
 * "Use without an account": pick the folder, show the shell's folder warnings
 * and wait for OK, then remember the choice and reload. Nothing is remembered
 * when the dialog is dismissed or the picker fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enterNoAccount, pickFolderOnly, type EnterNoAccountDeps } from "../enter-no-account";

function fakes(picked: false | { warnings: readonly string[] } | Error) {
  const calls: string[] = [];
  let releaseWarnings: () => void = () => {};
  const deps: EnterNoAccountDeps = {
    chooseFolder: async () => {
      calls.push("choose");
      if (picked instanceof Error) throw picked;
      return picked;
    },
    showWarnings: (warnings) => {
      calls.push(`warn:${warnings.join("|")}`);
      return new Promise<void>((resolve) => { releaseWarnings = resolve; });
    },
    remember: async () => { calls.push("remember"); },
    reload: () => { calls.push("reload"); },
  };
  return { deps, calls, ok: () => releaseWarnings() };
}

test("a picked folder with no warnings is remembered, then the window reloads", async () => {
  const { deps, calls } = fakes({ warnings: [] });
  assert.equal(await enterNoAccount(deps), true);
  assert.deepEqual(calls, ["choose", "remember", "reload"]);
});

test("a dismissed dialog remembers nothing and does not reload", async () => {
  const { deps, calls } = fakes(false);
  assert.equal(await enterNoAccount(deps), false);
  assert.deepEqual(calls, ["choose"]);
});

test("warnings are shown and nothing happens until the reader presses OK", async () => {
  const { deps, calls, ok } = fakes({ warnings: ["Not watched.", "Not remembered."] });
  const done = enterNoAccount(deps);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["choose", "warn:Not watched.|Not remembered."]);
  ok();
  assert.equal(await done, true);
  assert.deepEqual(calls, ["choose", "warn:Not watched.|Not remembered.", "remember", "reload"]);
});

test("a failing picker propagates and remembers nothing", async () => {
  const { deps, calls } = fakes(new Error("dialog failed"));
  await assert.rejects(enterNoAccount(deps), /dialog failed/);
  assert.deepEqual(calls, ["choose"]);
});

test("nothing syncs before remember(): the pick asks the shell for a folder and does nothing else", async () => {
  const touched: string[] = [];
  // Every bridge call is recorded; only chooseVaultRoot may run before remember().
  const bridge = new Proxy({} as { chooseVaultRoot: () => Promise<unknown> }, {
    get: (_target, name) => async () => {
      touched.push(String(name));
      return name === "chooseVaultRoot" ? { path: "C:/w", state: "empty", warnings: ["Not watched."] } : null;
    },
  });
  const calls: string[] = [];
  const done = await enterNoAccount({
    chooseFolder: async () => {
      const picked = await pickFolderOnly(bridge as never);
      calls.push(`picked:${touched.join(",")}`);
      return picked;
    },
    showWarnings: async (w) => { calls.push(`warn:${w.join("|")}`); },
    remember: async () => { calls.push("remember"); },
    reload: () => { calls.push("reload"); },
  });
  assert.equal(done, true);
  assert.deepEqual(calls, ["picked:chooseVaultRoot", "warn:Not watched.", "remember", "reload"]);
  assert.deepEqual(touched, ["chooseVaultRoot"]);
});

test("a dismissed or missing shell picks nothing", async () => {
  assert.equal(await pickFolderOnly(null), false);
  assert.equal(await pickFolderOnly({ chooseVaultRoot: async () => null }), false);
  assert.deepEqual(await pickFolderOnly({ chooseVaultRoot: async () => ({ path: "p", state: "existing" }) }), { warnings: [] });
});

test("the desktop wiring picks without the workspace-folder module (which watches and syncs)", () => {
  const src = readFileSync(new URL("../enter-no-account.ts", import.meta.url), "utf8");
  assert.match(src, /chooseFolder: \(\) => pickFolderOnly\(desktop\(\)\)/);
  assert.doesNotMatch(src, /workspace-folder|chooseDesktopFolder|requestSync/);
});

test("a failure to remember does not reload onto the wrong wiring", async () => {
  const { deps, calls } = fakes({ warnings: [] });
  deps.remember = async () => { throw new Error("storage denied"); };
  await assert.rejects(enterNoAccount(deps), /storage denied/);
  assert.deepEqual(calls, ["choose"]);
});
