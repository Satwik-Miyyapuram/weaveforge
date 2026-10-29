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

async function mount(h: ReturnType<typeof harness>): Promise<ReactTestRenderer> {
  // The viewer, once shown, fetches with the real browser deps; keep that request pending.
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(WorkshopPanel, { client: h.client, store: h.store }));
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

test("picking a project and root file shows the viewer for them", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  assert.equal(byName(tree, "rootResourcePath").props.value, "main.tex", "main.tex is the default root file");
  await type(byName(tree, "projectId"), "p2");
  await type(byName(tree, "rootResourcePath"), " chapters/thesis.tex ");
  await submit(tree);
  const viewer = tree.root.findByType(WorkshopPdfViewer);
  assert.deepEqual(viewer.props, { sessionId: SESSION, projectId: "p2", rootResourcePath: "chapters/thesis.tex" });
  await act(async () => tree.unmount());
});

test("a blank root file disables Show PDF", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  await type(byName(tree, "rootResourcePath"), "   ");
  assert.equal(button(tree, "Show PDF").props.disabled, true);
  await submit(tree);
  assert.equal(tree.root.findAllByType(WorkshopPdfViewer).length, 0);
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

test("the panel is shown only with an account and outside the desktop shell", () => {
  assert.equal(canShowWorkshop({ localMode: false, inDesktopShell: false }), true);
  assert.equal(canShowWorkshop({ localMode: true, inDesktopShell: false }), false);
  assert.equal(canShowWorkshop({ localMode: false, inDesktopShell: true }), false, "the shell relays no /api/overleaf/workshop routes");
  assert.equal(canShowWorkshop({ localMode: true, inDesktopShell: true }), false);
});
