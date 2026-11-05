import { test } from "node:test";
import assert from "node:assert/strict";
import type { DesktopBridge } from "@/lib/desktop/desktop-bridge";
import type { DesktopEvents } from "../desktop";
import {
  createSignInInbox,
  desktopBridge,
  install,
  SIGN_IN_EVENT,
  type ShellInfo,
} from "../inject";
import { tauriCore, type TauriInternals } from "../tauri-core";

type Reply =
  | { status: "ok"; data: unknown }
  | { status: "error"; error: { message: string } };

type Answer = Reply | (() => Promise<Reply>);

type BridgeCommands = Parameters<typeof desktopBridge>[0];

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
  ) as unknown as BridgeCommands;
  return { cmds, calls };
}

/** Fake shell events. Each `listen` records its handler; the unlisten it returns is a no-op. */
function fakeEvents() {
  const listens: { event: string; handler: (payload: unknown) => void }[] = [];
  const events: DesktopEvents = {
    listen: async (event, handler) => {
      listens.push({ event, handler });
      return () => {};
    },
  };
  return { events, listens };
}

const info: ShellInfo = { version: "0.9.0", platform: "linux" };

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("createSignInInbox hands a query delivered before any subscriber to the first subscriber, once", () => {
  const inbox = createSignInInbox();
  inbox.deliver("early");
  const first: string[] = [];
  const second: string[] = [];
  inbox.subscribe((q) => first.push(q));
  inbox.subscribe((q) => second.push(q));
  assert.deepEqual(first, ["early"]);
  assert.deepEqual(second, []);
  const late: string[] = [];
  inbox.subscribe((q) => late.push(q));
  assert.deepEqual(late, []);
});

test("createSignInInbox stops delivering to an unsubscribed listener", () => {
  const inbox = createSignInInbox();
  const seen: string[] = [];
  const stop = inbox.subscribe((q) => seen.push(q));
  stop();
  inbox.deliver("gone");
  assert.deepEqual(seen, []);
});

test("createSignInInbox sends live queries to every subscriber", () => {
  const inbox = createSignInInbox();
  const a: string[] = [];
  const b: string[] = [];
  inbox.subscribe((q) => a.push(q));
  inbox.subscribe((q) => b.push(q));
  inbox.deliver("live");
  assert.deepEqual(a, ["live"]);
  assert.deepEqual(b, ["live"]);
});

test("desktopBridge passes the version and platform through", () => {
  const bridge = desktopBridge(fakeCommands().cmds, fakeEvents().events, info);
  assert.equal(bridge.version, "0.9.0");
  assert.equal(bridge.platform, "linux");
});

test("desktopBridge listens to sign-in exactly once at construction, however many subscribers", () => {
  const fake = fakeEvents();
  const bridge = desktopBridge(fakeCommands().cmds, fake.events, info);
  bridge.onSignIn(() => {});
  bridge.onSignIn(() => {});
  assert.deepEqual(
    fake.listens.map((l) => l.event),
    [SIGN_IN_EVENT],
  );
});

test("desktopBridge delivers a string sign-in payload to the subscriber", () => {
  const fake = fakeEvents();
  const bridge = desktopBridge(fakeCommands().cmds, fake.events, info);
  const seen: string[] = [];
  bridge.onSignIn((q) => seen.push(q));
  fake.listens[0]!.handler("code=abc");
  assert.deepEqual(seen, ["code=abc"]);
});

test("desktopBridge ignores a sign-in payload that is not a string", () => {
  const fake = fakeEvents();
  const bridge = desktopBridge(fakeCommands().cmds, fake.events, info);
  const seen: string[] = [];
  bridge.onSignIn((q) => seen.push(q));
  fake.listens[0]!.handler({ code: "abc" });
  fake.listens[0]!.handler(null);
  fake.listens[0]!.handler(3);
  assert.deepEqual(seen, []);
});

test("menuModel answers the unwrapped groups", async () => {
  const groups = [{ label: "File", items: [] }];
  const { cmds, calls } = fakeCommands({
    menuModel: { status: "ok", data: groups },
  });
  const bridge = desktopBridge(cmds, fakeEvents().events, info);
  assert.deepEqual(await bridge.menuModel!(), groups);
  assert.deepEqual(calls, [{ cmd: "menuModel", args: [] }]);
});

test("menuModel rejects with the shell's message on an error result", async () => {
  const { cmds } = fakeCommands({
    menuModel: { status: "error", error: { message: "nope" } },
  });
  const bridge = desktopBridge(cmds, fakeEvents().events, info);
  await assert.rejects(
    () => bridge.menuModel!(),
    (e: unknown) => e instanceof Error && e.message === "nope",
  );
});

test("invokeMenuItem forwards the entry id", async () => {
  const { cmds, calls } = fakeCommands();
  const bridge = desktopBridge(cmds, fakeEvents().events, info);
  await bridge.invokeMenuItem!("file.save");
  assert.deepEqual(calls, [{ cmd: "menuInvoke", args: ["file.save"] }]);
});

test("setTitleBarColors forwards the two colours and does not throw when the command rejects", async () => {
  const { cmds, calls } = fakeCommands({
    titleBarColors: () => Promise.reject(new Error("ipc down")),
  });
  const warn = console.warn;
  const warned: unknown[] = [];
  console.warn = (...args: unknown[]) => {
    warned.push(args);
  };
  try {
    const bridge = desktopBridge(cmds, fakeEvents().events, info);
    assert.doesNotThrow(() =>
      bridge.setTitleBarColors!({ background: "#101010", ink: "#fafafa" }),
    );
    await tick();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(calls, [
    { cmd: "titleBarColors", args: ["#101010", "#fafafa"] },
  ]);
  assert.equal(warned.length, 1);
});

test("setWindowFocus forwards the boolean", async () => {
  const { cmds, calls } = fakeCommands();
  const bridge = desktopBridge(cmds, fakeEvents().events, info);
  bridge.setWindowFocus!(true);
  await tick();
  assert.deepEqual(calls, [{ cmd: "windowFocus", args: [true] }]);
});

test("tauriCore invoke forwards the command and args and answers the reply", async () => {
  const calls: unknown[][] = [];
  const core = tauriCore({
    invoke: async (cmd, args) => {
      calls.push([cmd, args]);
      return 5;
    },
    transformCallback: () => 1,
  });
  assert.equal(await core.invoke("ping", { x: 1 }), 5);
  assert.deepEqual(calls, [["ping", { x: 1 }]]);
});

test("tauriCore invoke rejects when the internals are missing", async () => {
  await assert.rejects(
    tauriCore(undefined).invoke("ping"),
    (e: unknown) =>
      e instanceof Error && e.message === "Tauri internals are missing",
  );
});

test("tauriCore listen registers a handler, passes the payload on, and unlistens by event id", async () => {
  const calls: { cmd: string; args: unknown }[] = [];
  const callbacks: ((event: { payload: unknown }) => void)[] = [];
  const internals: TauriInternals = {
    invoke: async (cmd, args) => {
      calls.push({ cmd, args });
      return cmd === "plugin:event|listen" ? 7 : null;
    },
    transformCallback: (cb) => {
      callbacks.push(cb);
      return 42;
    },
  };
  const seen: unknown[] = [];
  const unlisten = await tauriCore(internals).listen("sign-in", (p) =>
    seen.push(p),
  );
  assert.deepEqual(calls, [
    {
      cmd: "plugin:event|listen",
      args: { event: "sign-in", target: { kind: "Any" }, handler: 42 },
    },
  ]);
  callbacks[0]!({ payload: "hello" });
  assert.deepEqual(seen, ["hello"]);
  unlisten();
  assert.deepEqual(calls[1], {
    cmd: "plugin:event|unlisten",
    args: { event: "sign-in", eventId: 7 },
  });
});

test("install sets window.weaveforge and keeps one that is already set", () => {
  const empty: { weaveforge?: DesktopBridge } = {};
  install(empty, info, {
    commands: fakeCommands().cmds,
    listen: fakeEvents().events.listen,
  });
  assert.equal(empty.weaveforge?.version, "0.9.0");

  const existing = { version: "kept" } as unknown as DesktopBridge;
  const target: { weaveforge?: DesktopBridge } = { weaveforge: existing };
  install(target, info, {
    commands: fakeCommands().cmds,
    listen: fakeEvents().events.listen,
  });
  assert.equal(target.weaveforge, existing);
});
