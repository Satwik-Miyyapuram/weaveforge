import { test } from "node:test";
import assert from "node:assert/strict";
import { runShareAction } from "../ui/share-action.js";

function recorder() {
  const log: string[] = [];
  return {
    log,
    ui: {
      setBusy: (b: boolean) => log.push(`busy:${b}`),
      setError: (e: string | null) => log.push(`error:${e}`),
    },
  };
}

test("a failed access change shows the error and frees the dialog", async () => {
  // The dropdown called grant with no catch: a refused change was an unhandled
  // rejection, the dialog said nothing, and the dropdown looked as if it took.
  const { log, ui } = recorder();
  await runShareAction(async () => {
    throw new Error("permission denied");
  }, ui);
  assert.deepEqual(log, ["busy:true", "error:null", "error:permission denied", "busy:false"]);
});

test("a successful action clears any earlier error", async () => {
  const { log, ui } = recorder();
  let ran = false;
  await runShareAction(async () => {
    ran = true;
  }, ui);
  assert.equal(ran, true);
  assert.deepEqual(log, ["busy:true", "error:null", "busy:false"]);
});
