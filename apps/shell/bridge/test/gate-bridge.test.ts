import { test } from "node:test";
import assert from "node:assert/strict";
import { desktopShim, type DesktopCommands, type DesktopEvents } from "../desktop";

type Reply =
  | { status: "ok"; data: unknown }
  | { status: "error"; error: { message: string; code?: string } };

/** Fake commands that record each call; an unanswered command returns ok with null data. */
function fakeCommands(answers: Record<string, Reply> = {}) {
  const calls: { cmd: string; args: unknown[] }[] = [];
  const cmds = new Proxy(
    {},
    {
      get:
        (_target, cmd: string) =>
        async (...args: unknown[]) => {
          calls.push({ cmd, args });
          return answers[cmd] ?? { status: "ok", data: null };
        },
    },
  ) as unknown as DesktopCommands;
  return { cmds, calls };
}

const events: DesktopEvents = { listen: async () => () => {} };

/** The four typed error codes the 0.9.7 gate must fail closed on (DEL-RUST migrate.rs). */
const GATE_ERROR_CODES = [
  "app_data_unavailable",
  "device_id_unreadable",
  "migration_report_unreadable",
  "legacy_pg_unreadable",
] as const;

test("legacyDbPresent answers the shell's boolean, true and false", async () => {
  const yes = fakeCommands({ legacyDbPresent: { status: "ok", data: true } });
  assert.equal(await desktopShim(yes.cmds, events).legacyDbPresent(), true);
  assert.deepEqual(yes.calls.map((c) => c.cmd), ["legacyDbPresent"]);

  const no = fakeCommands({ legacyDbPresent: { status: "ok", data: false } });
  assert.equal(await desktopShim(no.cmds, events).legacyDbPresent(), false);
});

test("migrationReportVerified passes the folder and answers the shell's boolean", async () => {
  const { cmds, calls } = fakeCommands({
    migrationReportVerified: { status: "ok", data: true },
  });
  assert.equal(await desktopShim(cmds, events).migrationReportVerified("C:/notes"), true);
  assert.deepEqual(calls, [{ cmd: "migrationReportVerified", args: ["C:/notes"] }]);
});

for (const code of GATE_ERROR_CODES) {
  test(`legacyDbPresent rejects, never answers false, on ${code}`, async () => {
    const { cmds } = fakeCommands({
      legacyDbPresent: { status: "error", error: { message: `boom ${code}`, code } },
    });
    await assert.rejects(
      () => desktopShim(cmds, events).legacyDbPresent(),
      (e: unknown) =>
        e instanceof Error && e.message === `boom ${code}` && (e as { code?: string }).code === code,
    );
  });

  test(`migrationReportVerified rejects, never answers true, on ${code}`, async () => {
    const { cmds } = fakeCommands({
      migrationReportVerified: { status: "error", error: { message: `boom ${code}`, code } },
    });
    await assert.rejects(
      () => desktopShim(cmds, events).migrationReportVerified("C:/notes"),
      (e: unknown) =>
        e instanceof Error && e.message === `boom ${code}` && (e as { code?: string }).code === code,
    );
  });
}

test("planWidgetData passes the shell's plan widget data through, null included", async () => {
  const data = { items: [{ title: "Read ch. 3" }] };
  const some = fakeCommands({ planWidgetData: { status: "ok", data } });
  assert.deepEqual(await desktopShim(some.cmds, events).planWidgetData(), data);
  assert.deepEqual(some.calls.map((c) => c.cmd), ["planWidgetData"]);

  const none = fakeCommands({ planWidgetData: { status: "ok", data: null } });
  assert.equal(await desktopShim(none.cmds, events).planWidgetData(), null);
});

test("planWidgetData rejects with the shell's reason on error", async () => {
  const { cmds } = fakeCommands({
    planWidgetData: { status: "error", error: { message: "vault locked" } },
  });
  await assert.rejects(() => desktopShim(cmds, events).planWidgetData(), /vault locked/);
});

test("pickFolder answers the chosen path, or null when the dialog is cancelled", async () => {
  const picked = fakeCommands({ pickFolder: { status: "ok", data: "D:/lab" } });
  assert.equal(await desktopShim(picked.cmds, events).pickFolder(), "D:/lab");

  const cancelled = fakeCommands({ pickFolder: { status: "ok", data: null } });
  assert.equal(await desktopShim(cancelled.cmds, events).pickFolder(), null);
});
