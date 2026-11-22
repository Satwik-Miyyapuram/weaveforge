import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  canRemoveOld,
  isKeychainMissing,
  removeOldData,
  type RemoveOldDeps,
  type VerifyResult,
} from "../migrate-097-remove-old";
import { KEYCHAIN_INSTALL_BODY, RemoveOldDataButton, RemoveOldDataSection } from "../migrate-097-remove-old-button";

const FOLDER = "C:\\Users\\me\\Documents\\WeaveForge";
const BACKUP = "C:\\Users\\me\\Documents\\WeaveForge\\.weaveforge\\migration-0.9.7\\pre-migration.dump";
const passing: VerifyResult = { state: "verified", missing: [] };
const okDeps: RemoveOldDeps = {
  verify: async () => passing,
  moveSecrets: async () => {},
};

/** Records each call in order so tests can assert the verify -> move -> remove sequence. */
function recorder(): { calls: string[]; bridge: { migrate097RemoveOld(f: string): Promise<void> } } {
  const calls: string[] = [];
  return {
    calls,
    bridge: { migrate097RemoveOld: async (f: string) => void calls.push(`remove:${f}`) },
  };
}

test("only a verified, unremoved migration exported to this folder with a backup can offer removal", () => {
  const ok = { state: "verified", exportedTo: FOLDER, backupPath: BACKUP } as const;
  assert.equal(canRemoveOld(ok, FOLDER), true);
  assert.equal(canRemoveOld({ ...ok, state: "none" }, FOLDER), false);
  assert.equal(canRemoveOld({ ...ok, state: "incomplete" }, FOLDER), false);
  assert.equal(canRemoveOld({ ...ok, removedAt: "2026-11-22T10:00:00Z" }, FOLDER), false);
  assert.equal(canRemoveOld({ ...ok, exportedTo: undefined }, FOLDER), false);
  assert.equal(canRemoveOld({ ...ok, exportedTo: "D:\\Other" }, FOLDER), false);
});

test("fails closed when backupPath is absent or empty", () => {
  assert.equal(canRemoveOld({ state: "verified", exportedTo: FOLDER }, FOLDER), false);
  assert.equal(canRemoveOld({ state: "verified", exportedTo: FOLDER, backupPath: "" }, FOLDER), false);
});

test("removeOldData runs verify, then the secrets move, then the remove, in that order", async () => {
  const { calls, bridge } = recorder();
  const deps: RemoveOldDeps = {
    verify: async (f) => {
      calls.push(`verify:${f}`);
      return passing;
    },
    moveSecrets: async (f) => {
      calls.push(`move:${f}`);
    },
  };
  assert.equal(await removeOldData(bridge, deps, FOLDER), "removed");
  assert.deepEqual(calls, [`verify:${FOLDER}`, `move:${FOLDER}`, `remove:${FOLDER}`]);
});

test("removeOldData refuses when the verify says incomplete, and never moves or removes", async () => {
  const { calls, bridge } = recorder();
  const deps: RemoveOldDeps = {
    verify: async () => ({ state: "incomplete", missing: [] }),
    moveSecrets: async () => void calls.push("move"),
  };
  assert.equal(await removeOldData(bridge, deps, FOLDER), "refused");
  assert.deepEqual(calls, []);
});

test("removeOldData refuses when the verify still lists missing kinds", async () => {
  const { calls, bridge } = recorder();
  const deps: RemoveOldDeps = {
    verify: async () => ({ state: "verified", missing: ["notes"] }),
    moveSecrets: async () => void calls.push("move"),
  };
  assert.equal(await removeOldData(bridge, deps, FOLDER), "refused");
  assert.deepEqual(calls, []);
});

test("removeOldData refuses when the verify throws", async () => {
  const { calls, bridge } = recorder();
  const deps: RemoveOldDeps = {
    verify: async () => {
      throw new Error("export unavailable");
    },
    moveSecrets: async () => void calls.push("move"),
  };
  assert.equal(await removeOldData(bridge, deps, FOLDER), "refused");
  assert.deepEqual(calls, []);
});

test("removeOldData never removes when the secrets move fails for another reason", async () => {
  const { calls, bridge } = recorder();
  const deps: RemoveOldDeps = {
    verify: async () => passing,
    moveSecrets: async () => {
      throw new Error("disk full");
    },
  };
  assert.equal(await removeOldData(bridge, deps, FOLDER), "refused");
  assert.deepEqual(calls, []);
});

test("removeOldData reports keychain-missing and never removes when the keychain is absent", async () => {
  const { calls, bridge } = recorder();
  const deps: RemoveOldDeps = {
    verify: async () => passing,
    moveSecrets: async () => {
      throw new Error("This machine has no keychain available, so there is nowhere safe to keep it.");
    },
  };
  assert.equal(await removeOldData(bridge, deps, FOLDER), "keychain-missing");
  assert.deepEqual(calls, []);
});

test("isKeychainMissing matches only the no-keychain message", () => {
  assert.equal(isKeychainMissing(new Error("This machine has no keychain available")), true);
  assert.equal(isKeychainMissing(new Error("disk full")), false);
  assert.equal(isKeychainMissing("no keychain available"), false);
});

test("removeOldData refuses without a verify or move dependency", async () => {
  const { calls, bridge } = recorder();
  assert.equal(await removeOldData(bridge, { verify: null, moveSecrets: okDeps.moveSecrets }, FOLDER), "refused");
  assert.equal(await removeOldData(bridge, { verify: okDeps.verify, moveSecrets: null }, FOLDER), "refused");
  assert.deepEqual(calls, []);
});

test("removeOldData without the bridge method refuses and does not throw", async () => {
  assert.equal(await removeOldData({}, okDeps, FOLDER), "refused");
  assert.equal(await removeOldData(undefined, okDeps, FOLDER), "refused");
});

test("the button renders for a verified migration", () => {
  const html = renderToStaticMarkup(
    <RemoveOldDataButton
      folder={FOLDER}
      state="verified"
      exportedTo={FOLDER}
      backupPath={BACKUP}
      deps={okDeps}
      onRemoved={() => {}}
    />,
  );
  assert.match(html, /Remove old data/);
  assert.doesNotMatch(html, /pre-migration\.dump/, "the backup name appears only inside the confirm dialog");
});

test("the button is absent for none, incomplete, already-removed, unexported or unbacked states", () => {
  const cases: [string, string | undefined, string | undefined, string | undefined][] = [
    ["none", undefined, FOLDER, BACKUP],
    ["incomplete", undefined, FOLDER, BACKUP],
    ["verified", "2026-11-22T10:00:00Z", FOLDER, BACKUP],
    ["verified", undefined, undefined, BACKUP],
    ["verified", undefined, "D:\\Other", BACKUP],
    ["verified", undefined, FOLDER, undefined],
  ];
  for (const [state, removedAt, exportedTo, backupPath] of cases) {
    const html = renderToStaticMarkup(
      <RemoveOldDataButton
        folder={FOLDER}
        state={state as "none" | "verified" | "incomplete"}
        removedAt={removedAt}
        exportedTo={exportedTo}
        backupPath={backupPath}
        deps={okDeps}
        onRemoved={() => {}}
      />,
    );
    assert.equal(html, "", `${state} ${removedAt ?? ""} ${exportedTo ?? ""} ${backupPath ?? ""}`);
  }
});

test("the confirm dialog and keychain dialog are not open on first render", () => {
  const html = renderToStaticMarkup(
    <RemoveOldDataButton
      folder={FOLDER}
      state="verified"
      exportedTo={FOLDER}
      backupPath={BACKUP}
      deps={okDeps}
      onRemoved={() => {}}
    />,
  );
  assert.doesNotMatch(html, /This deletes the old local database data/);
  assert.doesNotMatch(html, new RegExp(KEYCHAIN_INSTALL_BODY.slice(0, 30)));
});

test("the settings section stays hidden when verify or move is not injected (fail closed)", () => {
  assert.equal(renderToStaticMarkup(<RemoveOldDataSection />), "");
  assert.equal(renderToStaticMarkup(<RemoveOldDataSection deps={null} />), "");
  assert.equal(
    renderToStaticMarkup(<RemoveOldDataSection deps={{ verify: okDeps.verify, moveSecrets: null }} />),
    "",
  );
});
