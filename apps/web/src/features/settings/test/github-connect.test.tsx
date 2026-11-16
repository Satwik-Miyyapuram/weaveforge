/**
 * One-click "Connect GitHub": the panel shows the device code big, opens
 * GitHub, waits, names the repo, then uploads the workspace at once; the
 * manual URL and token sit under Advanced. The onboarding card is on by
 * default and Skip keeps server sync. A refused token asks for a new sign-in.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { FolderRemoteSyncPanel } from "../ui/folder-remote-sync-panel";
import { GITHUB_ONBOARDING_KEY, GithubOnboarding } from "../ui/github-onboarding";
import { folderRemoteSync } from "@/features/workspace/application/parts-2";

const g = globalThis as { window?: unknown; navigator?: unknown };
const original = { window: g.window, navigator: g.navigator };
after(() => {
  g.window = original.window;
  Object.defineProperty(globalThis, "navigator", { value: original.navigator, configurable: true });
});

const CODE = { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device", expiresIn: 899 };
const CONNECTED = {
  login: "octo",
  repo: "octo/weaveforge-notes",
  url: "https://github.com/octo/weaveforge-notes.git",
  created: true,
};

interface Calls {
  opened: string[];
  copied: string[];
  sync: string[];
  finish: (string | null)[];
  cancel: number;
}

type Reply = Record<string, unknown>;

function stubWindow(
  opts: {
    url?: string | null;
    github?: boolean;
    stored?: Record<string, string>;
    reauth?: boolean;
    /** Answers one action; `undefined` falls through to the settings reply. */
    vault?: (action: string) => Promise<Reply> | undefined;
  } = {},
) {
  const calls: Calls = { opened: [], copied: [], sync: [], finish: [], cancel: 0 };
  const state = { reauth: opts.reauth ?? false };
  const store: Record<string, string> = { ...opts.stored };
  let release: (v: typeof CONNECTED) => void = () => undefined;
  const finished = new Promise<typeof CONNECTED>((r) => (release = r));
  const github =
    opts.github === false
      ? {}
      : {
          githubConnectStart: () => Promise.resolve(CODE),
          githubConnectFinish: (name: string | null) => {
            calls.finish.push(name);
            return finished;
          },
          githubConnectCancel: () => {
            calls.cancel += 1;
            return Promise.resolve();
          },
        };
  g.window = {
    localStorage: {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => void (store[k] = v),
      removeItem: (k: string) => void delete store[k],
    },
    open: (u: string) => void calls.opened.push(u),
    weaveforge: {
      fetchTitle: () => Promise.resolve({}),
      vaultSync: (action: string) => {
        calls.sync.push(action);
        return (
          opts.vault?.(action) ??
          Promise.resolve({ url: opts.url ?? null, hasToken: false, needsReconnect: state.reauth })
        );
      },
      ...github,
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: (t: string) => (calls.copied.push(t), Promise.resolve()) } },
    configurable: true,
  });
  return { calls, store, release, state };
}

const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((n) => n.type === "button" && textOf(n).includes(label));
const settle = () => new Promise((r) => setTimeout(r, 5));

async function mount(el: Parameters<typeof create>[0]): Promise<ReactTestRenderer> {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(el);
    await settle();
  });
  return tree;
}

async function click(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    button(tree, label).props.onClick();
    await settle();
  });
}

test("Connect GitHub shows the code big, opens GitHub, waits, then names the repo", async () => {
  const { calls, release } = stubWindow();
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  await click(tree, "Connect GitHub");

  const code = tree.root.find((n) => n.type === "code" && textOf(n) === "ABCD-1234");
  assert.ok(String(code.props.className).includes("github-code"));
  assert.deepEqual(calls.opened, ["https://github.com/login/device"]);
  assert.match(textOf(tree.root), /Waiting for GitHub/);
  assert.deepEqual(calls.finish, [null]);

  await click(tree, "Copy");
  assert.deepEqual(calls.copied, ["ABCD-1234"]);

  await act(async () => {
    release(CONNECTED);
    await settle();
  });
  const text = textOf(tree.root);
  assert.match(text, /Connected to octo\/weaveforge-notes/);
  assert.ok(!text.includes("Waiting for GitHub"));
  // The shell set the remote; the page connects it so git knows it too, then uploads.
  assert.deepEqual(calls.sync.slice(-2), ["connect", "push"]);
  assert.match(text, /Synced/);
});

test("the workspace uploads straight after connecting: Uploading, then Synced", async () => {
  let pushed: (r: Reply) => void = () => undefined;
  const { calls, release } = stubWindow({
    vault: (action) => (action === "push" ? new Promise<Reply>((r) => (pushed = r)) : undefined),
  });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  await click(tree, "Connect GitHub");
  await act(async () => {
    release(CONNECTED);
    await settle();
  });
  assert.match(textOf(tree.root), /Uploading your workspace…/);
  assert.ok(!textOf(tree.root).includes("Synced"));
  assert.equal(calls.sync.filter((a) => a === "push").length, 1);
  await act(async () => {
    pushed({ url: CONNECTED.url, hasToken: true, push: { kind: "pushed" } });
    await settle();
  });
  assert.match(textOf(tree.root), /Synced/);
  assert.ok(!textOf(tree.root).includes("Uploading"));
});

test("a failed upload shows why, and Retry uploads again", async () => {
  let fail = true;
  const { calls, release } = stubWindow({
    vault: (action) => {
      if (action !== "push") return undefined;
      if (fail) return Promise.reject(new Error("Could not reach github.com."));
      return Promise.resolve({ url: CONNECTED.url, hasToken: true, push: { kind: "pushed" } });
    },
  });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  await click(tree, "Connect GitHub");
  await act(async () => {
    release(CONNECTED);
    await settle();
  });
  assert.match(textOf(tree.root), /Could not reach github\.com\./);
  assert.ok(!textOf(tree.root).includes("Synced"));
  fail = false;
  await click(tree, "Retry");
  assert.equal(calls.sync.filter((a) => a === "push").length, 2);
  assert.match(textOf(tree.root), /Synced/);
  assert.ok(!textOf(tree.root).includes("Could not reach"));
});

test("an upload turned away by a repo with commits pulls first, then pushes", async () => {
  let pushes = 0;
  const { calls, release } = stubWindow({
    vault: (action) => {
      if (action === "pull") return Promise.resolve({ url: CONNECTED.url, hasToken: true, pull: { kind: "merged", oid: "a" } });
      if (action !== "push") return undefined;
      pushes += 1;
      const push = pushes === 1 ? { kind: "rejected", reason: "Pull first." } : { kind: "pushed" };
      return Promise.resolve({ url: CONNECTED.url, hasToken: true, push });
    },
  });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  await click(tree, "Connect GitHub");
  await act(async () => {
    release(CONNECTED);
    await settle();
  });
  assert.deepEqual(calls.sync.slice(-3), ["push", "pull", "push"]);
  assert.match(textOf(tree.root), /Synced/);
});

test("an upload stopped by files changed on both sides names them and offers Retry", async () => {
  const { release } = stubWindow({
    vault: (action) => {
      if (action === "pull")
        return Promise.resolve({ url: CONNECTED.url, hasToken: true, pull: { kind: "conflict", files: ["a.md"] } });
      if (action === "push")
        return Promise.resolve({ url: CONNECTED.url, hasToken: true, push: { kind: "rejected", reason: "Pull first." } });
      return undefined;
    },
  });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  await click(tree, "Connect GitHub");
  await act(async () => {
    release(CONNECTED);
    await settle();
  });
  assert.match(textOf(tree.root), /a\.md/);
  assert.ok(button(tree, "Retry"));
  assert.ok(!textOf(tree.root).includes("Synced"));
});

test("a refused token shows sign in again, and Reconnect reruns the device flow", async () => {
  const { calls, release, state } = stubWindow({ url: CONNECTED.url, reauth: true });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  assert.match(textOf(tree.root), /GitHub needs you to sign in again/);
  await click(tree, "Reconnect");
  assert.match(textOf(tree.root), /ABCD-1234/);
  assert.deepEqual(calls.finish, [null]);
  state.reauth = false;
  await act(async () => {
    release(CONNECTED);
    await settle();
  });
  assert.ok(!textOf(tree.root).includes("sign in again"));
  assert.match(textOf(tree.root), /Synced/);
});

test("a pull that fails on a refused token flags Reconnect in the panel", async () => {
  const { state } = stubWindow({
    url: CONNECTED.url,
    vault: (action) => (action === "pull" ? Promise.reject(new Error("The token was refused.")) : undefined),
  });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  assert.ok(!textOf(tree.root).includes("sign in again"));
  state.reauth = true;
  await click(tree, "Pull");
  assert.match(textOf(tree.root), /The token was refused\./);
  assert.match(textOf(tree.root), /GitHub needs you to sign in again/);
  assert.ok(button(tree, "Reconnect"));
});

test("the card comes back to ask for a sign-in, even after Skip, and mid-session", async () => {
  const { state } = stubWindow({ url: CONNECTED.url, stored: { [GITHUB_ONBOARDING_KEY]: "skipped" } });
  const tree = await mount(createElement(GithubOnboarding));
  assert.equal(tree.toJSON(), null);
  state.reauth = true;
  // Any sync that fails (here a pull from elsewhere in the app) re-reads the flag.
  await act(async () => {
    await folderRemoteSync("pull").catch(() => undefined);
    await settle();
  });
  // The stub pull succeeds, so nothing is raised yet; a failing one is.
  assert.equal(tree.toJSON(), null);
  const failing = stubWindow({
    url: CONNECTED.url,
    reauth: true,
    stored: { [GITHUB_ONBOARDING_KEY]: "skipped" },
    vault: (action) => (action === "push" ? Promise.reject(new Error("The token was refused.")) : undefined),
  });
  const card = await mount(createElement(GithubOnboarding));
  assert.match(textOf(card.root), /GitHub needs you to sign in again/);
  failing.state.reauth = false;
  const later = await mount(createElement(GithubOnboarding));
  assert.equal(later.toJSON(), null);
  failing.state.reauth = true;
  await act(async () => {
    await folderRemoteSync("push").catch(() => undefined);
    await settle();
  });
  assert.match(textOf(later.root), /GitHub needs you to sign in again/);
  assert.ok(button(later, "Reconnect"));
});

test("Cancel stops the wait and tells the shell", async () => {
  const { calls } = stubWindow();
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  await click(tree, "Connect GitHub");
  await click(tree, "Cancel");
  assert.equal(calls.cancel, 1);
  assert.ok(!textOf(tree.root).includes("Waiting for GitHub"));
  assert.ok(button(tree, "Connect GitHub"));
});

test("the manual URL and token stay, under Advanced", async () => {
  stubWindow();
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  const details = tree.root.find((n) => n.type === "details");
  assert.match(textOf(details.find((n) => n.type === "summary")), /Advanced/);
  assert.ok(details.find((n) => n.props.id === "git-remote-token"));
  assert.ok(details.find((n) => n.props.id === "git-remote-url"));
});

test("an older shell without device flow shows no Connect GitHub button", async () => {
  stubWindow({ github: false });
  const tree = await mount(createElement(FolderRemoteSyncPanel));
  assert.equal(tree.root.findAll((n) => n.type === "button" && textOf(n).includes("Connect GitHub")).length, 0);
});

test("onboarding is on by default: Connect GitHub first, Skip second", async () => {
  stubWindow();
  const tree = await mount(createElement(GithubOnboarding));
  const text = textOf(tree.root);
  assert.match(text, /your own private GitHub repository/);
  assert.match(text, /the WeaveForge server only relays live shared sessions/);
  assert.match(text, /GitHub can read/);
  const buttons = tree.root.findAll((n) => n.type === "button").map(textOf);
  assert.deepEqual(buttons.slice(0, 2), ["Connect GitHub", "Skip"]);
  assert.equal(button(tree, "Connect GitHub").props.className.includes("primary"), true);
});

test("Skip keeps server sync and does not ask again", async () => {
  const { store, calls } = stubWindow();
  const tree = await mount(createElement(GithubOnboarding));
  await click(tree, "Skip");
  assert.equal(tree.toJSON(), null);
  assert.equal(store[GITHUB_ONBOARDING_KEY], "skipped");
  assert.equal(calls.finish.length, 0);

  const again = await mount(createElement(GithubOnboarding));
  assert.equal(again.toJSON(), null);
});

test("a remembered Skip keeps the card hidden on the next render", async () => {
  stubWindow({ stored: { [GITHUB_ONBOARDING_KEY]: "skipped" } });
  const tree = await mount(createElement(GithubOnboarding));
  assert.equal(tree.toJSON(), null);
});

test("Connect GitHub is the primary action and starts the device flow", async () => {
  const { calls, store } = stubWindow();
  const tree = await mount(createElement(GithubOnboarding));
  const connect = button(tree, "Connect GitHub");
  assert.match(String(connect.props.className), /primary/);
  await click(tree, "Connect GitHub");
  assert.deepEqual(calls.finish, [null]);
  assert.deepEqual(calls.opened, ["https://github.com/login/device"]);
  assert.match(textOf(tree.root), /ABCD-1234/);
  assert.equal(store[GITHUB_ONBOARDING_KEY], undefined);
});

test("the card still renders and Skip still works when storage throws", async () => {
  const { calls } = stubWindow();
  const win = g.window as { localStorage: unknown };
  const broken = () => {
    throw new Error("storage blocked");
  };
  win.localStorage = { getItem: broken, setItem: broken, removeItem: broken };
  const tree = await mount(createElement(GithubOnboarding));
  assert.match(textOf(tree.root), /Sync with GitHub/);
  await click(tree, "Skip");
  assert.equal(tree.toJSON(), null);
  assert.equal(calls.finish.length, 0);
});

test("the card copy says GitHub holds the files and the server only relays live shared sessions", async () => {
  stubWindow();
  const tree = await mount(createElement(GithubOnboarding));
  const text = textOf(tree.root);
  assert.match(text, /GitHub holds your synced files/);
  assert.match(text, /the WeaveForge server only relays live shared sessions/);
  assert.ok(!/only relays live sessions and shared items/.test(text));
});

test("onboarding stays away when a remote is already set or the shell is older", async () => {
  stubWindow({ url: "https://github.com/octo/notes.git" });
  assert.equal((await mount(createElement(GithubOnboarding))).toJSON(), null);
  stubWindow({ github: false });
  assert.equal((await mount(createElement(GithubOnboarding))).toJSON(), null);
});
