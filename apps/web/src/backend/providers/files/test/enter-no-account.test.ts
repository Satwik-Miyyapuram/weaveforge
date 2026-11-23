/**
 * "Use without an account": pick the folder, show the shell's folder warnings
 * and wait for OK, then remember the choice and reload. Nothing is remembered
 * when the dialog is dismissed or the picker fails.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { enterNoAccount, type EnterNoAccountDeps } from "../enter-no-account";

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

test("a failure to remember does not reload onto the wrong wiring", async () => {
  const { deps, calls } = fakes({ warnings: [] });
  deps.remember = async () => { throw new Error("storage denied"); };
  await assert.rejects(enterNoAccount(deps), /storage denied/);
  assert.deepEqual(calls, ["choose"]);
});
