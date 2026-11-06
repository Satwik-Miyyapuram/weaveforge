import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import { WorkshopPanel, canShowWorkshop, type WorkshopSessionStore } from "../ui/workshop-panel";
import { WorkshopPdfViewer } from "../ui/workshop-pdf-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SESSION = "3f6c2a9e-1b2d-4c5e-8f70-123456789abc";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

type Route = (url: string, init: RequestInit) => Response;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function harness(route: Route, stored: string | null = null) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const client: WorkshopClientDeps = {
    fetch: async (url, init) => {
      calls.push({ url, method: String(init.method), body: init.body ? JSON.parse(String(init.body)) : null });
      return route(url, init);
    },
    authHeaders: async (extra) => ({ ...(extra as Record<string, string>), Authorization: "Bearer t" }),
  };
  const box = { id: stored };
  const store: WorkshopSessionStore = { get: () => box.id, set: (id) => void (box.id = id) };
  return { client, store, calls, box };
}

const projectsOk: Route = (url) =>
  url.endsWith("/session") ? json({ sessionId: SESSION }, 201) : json({ projects: [{ id: "p2", name: "Thesis" }, { id: "p1", name: "Abstract" }] });

type ExtraProps = { signInWindow?: () => Promise<string | null>; canEditAsFiles?: boolean };

async function mount(h: ReturnType<typeof harness>, inShell = false, extra: ExtraProps = {}): Promise<ReactTestRenderer> {
  // The viewer, once shown, fetches with the real browser deps; keep that request pending.
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(WorkshopPanel, { client: h.client, store: h.store, inShell, ...extra }));
  });
  return tree!;
}

/** The project picker's option values, read from the shared Select's children. */
const projectOptions = (tree: ReactTestRenderer) =>
  ([] as { props: { value: string } }[]).concat(byName(tree, "projectId").props.children).map((o) => o.props.value);
const text = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
const byName = (tree: ReactTestRenderer, name: string) => tree.root.find((n) => n.props.name === name);
/** A node's rendered text. Children can be elements with owners, which JSON.stringify cannot walk. */
const textOf = (node: ReactTestInstance): string =>
  node.children.map((c) => (typeof c === "string" ? c : textOf(c))).join("");
const buttons = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.type === "button" && textOf(n).includes(label));
const button = (tree: ReactTestRenderer, label: string) => {
  const [found, ...rest] = buttons(tree, label);
  assert.ok(found && rest.length === 0, `exactly one "${label}" button`);
  return found;
};

async function type(node: ReactTestInstance, value: string) {
  await act(async () => node.props.onChange({ target: { value } }));
}
async function submit(tree: ReactTestRenderer) {
  await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
}

test("with no stored session the panel asks for the cookie and makes no request", async () => {
  const h = harness(projectsOk);
  const tree = await mount(h);
  assert.ok(byName(tree, "cookies"));
  assert.equal(h.calls.length, 0);
  assert.equal(tree.root.findAllByType(WorkshopPdfViewer).length, 0);
  await act(async () => tree.unmount());
});

test("the cookie note says where the cookie is kept: the server, or the app's memory", async () => {
  const hosted = await mount(harness(projectsOk));
  assert.ok(text(hosted).includes("stored encrypted on the server"));
  await act(async () => hosted.unmount());
  const shell = await mount(harness(projectsOk), true);
  assert.ok(text(shell).includes("encrypted in this device's keychain"));
  assert.ok(!text(shell).includes("on the server"));
  await act(async () => shell.unmount());
});

test("signing in stores only the session id and lists projects by name", async () => {
  const h = harness(projectsOk);
  const tree = await mount(h);
  await type(byName(tree, "cookies"), "overleaf_session2=abc");
  await submit(tree);
  assert.equal(h.box.id, SESSION);
  assert.deepEqual(h.calls.map((c) => c.url), ["/api/overleaf/workshop/session", "/api/overleaf/workshop/projects"]);
  const options = projectOptions(tree);
  assert.deepEqual(options, ["p1", "p2"]);
  assert.ok(!text(tree).includes("overleaf_session2=abc"), "the cookie is not kept on screen");
  await act(async () => tree.unmount());
});

test("a rejected cookie shows the server error and stores nothing", async () => {
  const h = harness(() => json({ error: "Overleaf sign-in failed." }, 401));
  const tree = await mount(h);
  await type(byName(tree, "cookies"), "bad");
  await submit(tree);
  assert.equal(h.box.id, null);
  assert.match(text(tree), /Overleaf sign-in failed\./);
  assert.ok(byName(tree, "cookies"));
  await act(async () => tree.unmount());
});

test("a stored session loads projects on mount", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  assert.deepEqual(h.calls.map((c) => c.body), [{ sessionId: SESSION }]);
  assert.equal(projectOptions(tree).length, 2);
  await act(async () => tree.unmount());
});

test("an expired stored session is forgotten and the cookie form returns", async () => {
  const h = harness(() => json({ error: "Overleaf session not found. Sign in again.", expired: true }, 401), SESSION);
  const tree = await mount(h);
  assert.equal(h.box.id, null);
  assert.ok(byName(tree, "cookies"));
  assert.match(text(tree), /Sign in again/);
  await act(async () => tree.unmount());
});

test("an account with no projects says so and offers no PDF button", async () => {
  const h = harness(() => json({ projects: [] }), SESSION);
  const tree = await mount(h);
  assert.match(text(tree), /No Overleaf projects/);
  assert.equal(buttons(tree, "Show PDF").length, 0);
  await act(async () => tree.unmount());
});

test("picking a project shows the viewer with the panel's own headers", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  await type(byName(tree, "projectId"), "p2");
  await submit(tree);
  const viewer = tree.root.findByType(WorkshopPdfViewer);
  assert.deepEqual(viewer.props, { sessionId: SESSION, projectId: "p2", authHeaders: h.client.authHeaders });
  await act(async () => tree.unmount());
});

test("there is no root file field: Overleaf compiles the project's main document", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  assert.equal(tree.root.findAll((n) => n.props.name === "rootResourcePath").length, 0);
  assert.equal(button(tree, "Show PDF").props.disabled, false);
  await act(async () => tree.unmount());
});

test("disconnecting deletes the session server-side and forgets it locally", async () => {
  const h = harness((url, init) => (init.method === "DELETE" ? json({ ok: true }) : projectsOk(url, init)), SESSION);
  const tree = await mount(h);
  await act(async () => button(tree, "Disconnect").props.onClick());
  assert.equal(h.box.id, null);
  assert.deepEqual(h.calls.at(-1), { url: `/api/overleaf/workshop/session?id=${SESSION}`, method: "DELETE", body: null });
  assert.ok(byName(tree, "cookies"));
  await act(async () => tree.unmount());
});

test("a failed project list (Overleaf rejects the stored cookie, 502) keeps Disconnect reachable", async () => {
  const h = harness((_url, init) => (init.method === "DELETE" ? json({ ok: true }) : json({ error: "Overleaf sign-in failed." }, 502)), SESSION);
  const tree = await mount(h);
  assert.match(text(tree), /Overleaf sign-in failed\./);
  assert.ok(!text(tree).includes("Loading Overleaf projects"), "the panel is not stuck loading");
  assert.equal(h.box.id, SESSION, "a 502 does not forget the session by itself");
  await act(async () => button(tree, "Disconnect").props.onClick());
  assert.equal(h.box.id, null);
  assert.equal(h.calls.at(-1)?.method, "DELETE");
  assert.ok(byName(tree, "cookies"), "the cookie form is back");
  assert.ok(!text(tree).includes("Overleaf sign-in failed"), "the old error is cleared");
  await act(async () => tree.unmount());
});

test("Retry after a failed project list loads the projects and clears the error", async () => {
  let fail = true;
  const h = harness((url, init) => (fail ? json({ error: "Overleaf is down." }, 502) : projectsOk(url, init)), SESSION);
  const tree = await mount(h);
  assert.match(text(tree), /Overleaf is down\./);
  fail = false;
  await act(async () => button(tree, "Retry").props.onClick());
  assert.equal(projectOptions(tree).length, 2);
  assert.ok(!text(tree).includes("Overleaf is down"), "a successful load clears the earlier error");
  assert.equal(h.calls.filter((c) => c.url.endsWith("/projects")).length, 2);
  await act(async () => tree.unmount());
});

test("a 401 from the app's own sign-in keeps the stored Overleaf session", async () => {
  const h = harness(() => json({ error: "Unauthorized" }, 401), SESSION);
  const tree = await mount(h);
  assert.equal(h.box.id, SESSION);
  assert.ok(button(tree, "Disconnect"));
  await act(async () => tree.unmount());
});

const radios = (tree: ReactTestRenderer) => tree.root.findAll((n) => n.type === "input" && n.props.type === "radio");
const optionLabel = (tree: ReactTestRenderer, mode: string) =>
  tree.root.find((n) => n.type === "label" && n.findAll((c) => c.type === "input" && c.props.value === mode).length > 0);

test("both connect options are offered, each with a hover tip naming its limits", async () => {
  const tree = await mount(harness(projectsOk));
  assert.deepEqual(radios(tree).map((r) => r.props.value), ["signin", "git"]);
  assert.match(optionLabel(tree, "signin").props.title, /any plan/i);
  assert.match(optionLabel(tree, "signin").props.title, /passwords/i);
  assert.match(optionLabel(tree, "git").props.title, /institution licence/i);
  assert.match(optionLabel(tree, "git").props.title, /about a year/);
  assert.match(optionLabel(tree, "git").props.title, /LaTeX/);
  await act(async () => tree.unmount());
});

test("the sign-in window's session id is stored and projects load, with no cookie sent", async () => {
  const h = harness(projectsOk);
  const tree = await mount(h, true, { signInWindow: async () => SESSION });
  await act(async () => button(tree, "Sign in to Overleaf").props.onClick());
  assert.equal(h.box.id, SESSION);
  assert.ok(h.calls.every((c) => !c.url.endsWith("/session")));
  assert.equal(projectOptions(tree).length, 2);
  await act(async () => tree.unmount());
});

test("closing the sign-in window stores nothing, and the cookie stays as a fallback", async () => {
  const h = harness(projectsOk);
  const tree = await mount(h, true, { signInWindow: async () => null });
  await act(async () => button(tree, "Sign in to Overleaf").props.onClick());
  assert.equal(h.box.id, null);
  assert.equal(h.calls.length, 0);
  assert.ok(byName(tree, "cookies"));
  await act(async () => tree.unmount());
});

test("a sign-in window that fails shows its message", async () => {
  const tree = await mount(harness(projectsOk), true, {
    signInWindow: async () => { throw new Error("Could not open the Overleaf sign-in window."); },
  });
  await act(async () => button(tree, "Sign in to Overleaf").props.onClick());
  assert.match(text(tree), /Could not open the Overleaf sign-in window/);
  await act(async () => tree.unmount());
});

test("the git option points to Settings, or says it needs the desktop app", async () => {
  const pick = async (tree: ReactTestRenderer) =>
    act(async () => radios(tree).find((r) => r.props.value === "git")!.props.onChange());
  // next/link prefetches through `self`, which node lacks.
  (globalThis as { self?: unknown }).self ??= globalThis;
  const desktopApp = await mount(harness(projectsOk), true, { canEditAsFiles: true });
  await pick(desktopApp);
  assert.ok(desktopApp.root.findAll((n) => n.props.href === "/settings#settings-workspace").length > 0);
  assert.equal(desktopApp.root.findAll((n) => n.props.name === "cookies").length, 0);
  await act(async () => desktopApp.unmount());
  const browser = await mount(harness(projectsOk), false, { canEditAsFiles: false });
  await pick(browser);
  assert.match(text(browser), /needs the WeaveForge desktop app/);
  await act(async () => browser.unmount());
});

test("the panel is shown with an account, and in the Tauri shell even without one", () => {
  assert.equal(canShowWorkshop({ localMode: false }), true);
  assert.equal(canShowWorkshop({ localMode: true }), false);
  assert.equal(canShowWorkshop({ localMode: true, shell: true }), true);
  assert.equal(canShowWorkshop({ localMode: false, shell: true }), true);
});
