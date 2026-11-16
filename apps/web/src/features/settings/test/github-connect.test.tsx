/**
 * One-click "Connect GitHub": the panel shows the device code big, opens
 * GitHub, waits, then names the repo; the manual URL and token sit under
 * Advanced. The onboarding card is on by default and Skip keeps server sync.
 */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import "@/lib/test/react-harness";
import { FolderRemoteSyncPanel } from "../ui/folder-remote-sync-panel";
import { GITHUB_ONBOARDING_KEY, GithubOnboarding } from "../ui/github-onboarding";

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

function stubWindow(opts: { url?: string | null; github?: boolean; stored?: Record<string, string> } = {}) {
  const calls: Calls = { opened: [], copied: [], sync: [], finish: [], cancel: 0 };
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
        return Promise.resolve({ url: opts.url ?? null, hasToken: false });
      },
      ...github,
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    value: { clipboard: { writeText: (t: string) => (calls.copied.push(t), Promise.resolve()) } },
    configurable: true,
  });
  return { calls, store, release };
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
  // The shell set the remote; the page connects it so git knows it too.
  assert.ok(calls.sync.includes("connect"));
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
  assert.match(text, /only relays live sessions and shared items/);
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

test("onboarding stays away when a remote is already set or the shell is older", async () => {
  stubWindow({ url: "https://github.com/octo/notes.git" });
  assert.equal((await mount(createElement(GithubOnboarding))).toJSON(), null);
  stubWindow({ github: false });
  assert.equal((await mount(createElement(GithubOnboarding))).toJSON(), null);
});
