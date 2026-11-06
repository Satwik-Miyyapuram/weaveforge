import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { LinkedReport, ReportContent } from "../ui/linked-overleaf-api";
import { OverleafWorkspace } from "../ui/overleaf-workspace";
import { OverleafOutline } from "../ui/overleaf-outline";
import type { ProjectPicksStore } from "../ui/overleaf-project-picks";
import { tabBlockers } from "../ui/overleaf-project-detail";
import type { LinkedReportsGateway } from "../ui/use-linked-reports";
import { canShowWorkshop, type WorkshopSessionStore } from "../ui/use-workshop-session";
import { WorkshopPdfViewer } from "../ui/workshop-pdf-viewer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// next/link prefetches through `self`, which node lacks.
(globalThis as { self?: unknown }).self ??= globalThis;

const SESSION = "3f6c2a9e-1b2d-4c5e-8f70-123456789abc";
const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

type Route = (url: string, init: RequestInit) => Response;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const LIVE_TREE = [{ docs: [{ _id: "d1", name: "main.tex" }] }];
const LIVE_TEXT = ["\\begin{document}", "\\section{Live intro}", "one two three", "\\end{document}"];

/** Sign-in routes: session, projects, and the live routes the outline reads. */
const projectsOk: Route = (url) => {
  if (url.endsWith("/session")) return json({ sessionId: SESSION }, 201);
  if (url.endsWith("/open")) return json({ liveId: "L1", name: "Thesis", rootDocId: "d1", rootFolder: LIVE_TREE, permissionsLevel: "owner" });
  if (url.endsWith("/doc")) return json({ lines: LIVE_TEXT, version: 1 });
  if (url.endsWith("/close")) return json({});
  return json({ projects: [{ id: "p2", name: "Thesis" }, { id: "p1", name: "Abstract" }] });
};

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

function report(id: string, overleafProjectId: string, title: string): LinkedReport {
  return {
    id, project_id: "wf1", title, connection_id: "c1", overleaf_project_id: overleafProjectId,
    entry_file: "main.tex", external_url: null, last_fetched_at: null, section_targets: { "Git intro": 500 },
  };
}

const GIT_CONTENT: ReportContent = {
  files: [{ path: "main.tex", content: "\\section{Git intro}\nfour five" }],
  entryFile: "main.tex",
  sectionTree: { roots: [], files: ["main.tex"], warnings: [] },
  overleafUrl: "https://www.overleaf.com/project/p9",
};

function fakeGateway(reports: LinkedReport[] = []) {
  const reads: string[] = [];
  const gateway: LinkedReportsGateway = {
    list: async () => [...reports],
    unlink: async () => {},
    setTargets: async () => {},
    readContent: async (r) => { reads.push(r.id); return GIT_CONTENT; },
  };
  return { gateway, reads };
}

type Extra = {
  inShell?: boolean;
  signInWindow?: () => Promise<string | null>;
  canEditAsFiles?: boolean;
  workshop?: boolean;
  projectId?: string | null;
  gateway?: LinkedReportsGateway;
  picks?: ProjectPicksStore;
  onExport?: () => void;
};

/** A picks store in memory; `ids` is what it holds. */
function memoryPicks(initial: string[] | null = null) {
  const box = { ids: initial };
  const picks: ProjectPicksStore = { get: () => box.ids, set: (ids) => void (box.ids = ids) };
  return { picks, box };
}

async function mount(h: ReturnType<typeof harness>, extra: Extra = {}): Promise<ReactTestRenderer> {
  // The PDF viewer, once shown, fetches with the real browser deps; keep that request pending.
  globalThis.fetch = (() => new Promise(() => {})) as typeof fetch;
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(OverleafWorkspace, {
      client: h.client,
      store: h.store,
      inShell: false,
      canEditAsFiles: false,
      workshop: true,
      projectId: "wf1",
      gateway: fakeGateway().gateway,
      picks: memoryPicks().picks,
      onExport: () => {},
      ...extra,
    }));
  });
  return tree!;
}

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
/** The project list's rows, as their text. */
const rows = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === "button" && n.props.className === "wf-row").map(textOf);
const openRow = async (tree: ReactTestRenderer, name: string) => {
  const row = tree.root.find((n) => n.type === "button" && n.props.className === "wf-row" && textOf(n).includes(name));
  await act(async () => row.props.onClick());
};
const tab = async (tree: ReactTestRenderer, label: string) => {
  const found = tree.root.find((n) => n.type === "button" && n.props.role === "tab" && textOf(n) === label);
  await act(async () => found.props.onClick());
};
/** Lets the outline's load (several awaited requests) settle. */
const settle = async () => { for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

async function type(node: ReactTestInstance, value: string) {
  await act(async () => node.props.onChange({ target: { value } }));
}
async function submitCookie(tree: ReactTestRenderer) {
  const form = tree.root.find((n) => n.type === "form" && n.findAll((c) => c.props.name === "cookies").length > 0);
  await act(async () => form.props.onSubmit({ preventDefault() {} }));
}

// ---- Connect step ----

test("with no stored session it offers to connect and makes no request", async () => {
  const h = harness(projectsOk);
  const tree = await mount(h);
  assert.ok(byName(tree, "cookies"));
  assert.equal(h.calls.length, 0);
  assert.match(text(tree), /No Overleaf projects yet/);
  await act(async () => tree.unmount());
});

test("the cookie note says where the cookie is kept: the server, or the keychain", async () => {
  const hosted = await mount(harness(projectsOk));
  assert.ok(text(hosted).includes("stored encrypted on the server"));
  await act(async () => hosted.unmount());
  const shell = await mount(harness(projectsOk), { inShell: true });
  assert.ok(text(shell).includes("encrypted in this device's keychain"));
  assert.ok(!text(shell).includes("on the server"));
  await act(async () => shell.unmount());
});

test("signing in stores only the session id and lists the projects by name", async () => {
  const h = harness(projectsOk);
  const tree = await mount(h);
  await type(byName(tree, "cookies"), "overleaf_session2=abc");
  await submitCookie(tree);
  assert.equal(h.box.id, SESSION);
  assert.deepEqual(h.calls.map((c) => c.url), ["/api/overleaf/workshop/session", "/api/overleaf/workshop/projects"]);
  assert.deepEqual(rows(tree).map((r) => r.split("In your")[0]), ["Abstract", "Thesis"]);
  assert.ok(!text(tree).includes("overleaf_session2=abc"), "the cookie is not kept on screen");
  assert.equal(tree.root.findAll((n) => n.props.name === "cookies").length, 0, "the connect step is gone");
  assert.ok(!text(tree).includes("Signed in to Overleaf"), "no account bar on the page");
  await act(async () => button(tree, "Settings").props.onClick());
  assert.match(text(tree), /Signed in to Overleaf/);
  await act(async () => tree.unmount());
});

test("a rejected cookie shows the server error and stores nothing", async () => {
  const h = harness(() => json({ error: "Overleaf sign-in failed." }, 401));
  const tree = await mount(h);
  await type(byName(tree, "cookies"), "bad");
  await submitCookie(tree);
  assert.equal(h.box.id, null);
  assert.match(text(tree), /Overleaf sign-in failed\./);
  assert.ok(byName(tree, "cookies"));
  await act(async () => tree.unmount());
});

test("an expired stored session is forgotten and the connect step returns", async () => {
  const h = harness(() => json({ error: "Overleaf session not found. Sign in again.", expired: true }, 401), SESSION);
  const tree = await mount(h);
  assert.equal(h.box.id, null);
  assert.ok(byName(tree, "cookies"));
  assert.match(text(tree), /Sign in again/);
  await act(async () => tree.unmount());
});

test("disconnecting deletes the session server-side and forgets it locally", async () => {
  const h = harness((url, init) => (init.method === "DELETE" ? json({ ok: true }) : projectsOk(url, init)), SESSION);
  const tree = await mount(h);
  await act(async () => button(tree, "Settings").props.onClick());
  await act(async () => button(tree, "Disconnect").props.onClick());
  assert.equal(h.box.id, null);
  assert.deepEqual(h.calls.at(-1), { url: `/api/overleaf/workshop/session?id=${SESSION}`, method: "DELETE", body: null });
  assert.ok(byName(tree, "cookies"));
  await act(async () => tree.unmount());
});

test("a failed project list (502) keeps the session, and Retry loads it", async () => {
  let fail = true;
  const h = harness((url, init) => (fail ? json({ error: "Overleaf is down." }, 502) : projectsOk(url, init)), SESSION);
  const tree = await mount(h);
  assert.match(text(tree), /Overleaf is down\./);
  assert.equal(h.box.id, SESSION, "a 502 does not forget the session by itself");
  assert.ok(!text(tree).includes("Loading projects"), "not stuck loading");
  fail = false;
  await act(async () => button(tree, "Retry").props.onClick());
  assert.equal(rows(tree).length, 2);
  assert.ok(!text(tree).includes("Overleaf is down"), "a successful load clears the error");
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
  const tree = await mount(h, { inShell: true, signInWindow: async () => SESSION });
  await act(async () => button(tree, "Sign in to Overleaf").props.onClick());
  assert.equal(h.box.id, SESSION);
  assert.ok(h.calls.every((c) => !c.url.endsWith("/session")));
  assert.equal(rows(tree).length, 2);
  await act(async () => tree.unmount());
});

test("closing the sign-in window stores nothing; a failing one shows its message", async () => {
  const h = harness(projectsOk);
  const closed = await mount(h, { inShell: true, signInWindow: async () => null });
  await act(async () => button(closed, "Sign in to Overleaf").props.onClick());
  assert.equal(h.box.id, null);
  assert.equal(h.calls.length, 0);
  await act(async () => closed.unmount());
  const failing = await mount(harness(projectsOk), {
    inShell: true,
    signInWindow: async () => { throw new Error("Could not open the Overleaf sign-in window."); },
  });
  await act(async () => button(failing, "Sign in to Overleaf").props.onClick());
  assert.match(text(failing), /Could not open the Overleaf sign-in window/);
  await act(async () => failing.unmount());
});

test("the git option points to Settings, or says it needs the desktop app", async () => {
  const pick = async (tree: ReactTestRenderer) =>
    act(async () => radios(tree).find((r) => r.props.value === "git")!.props.onChange());
  const desktopApp = await mount(harness(projectsOk), { inShell: true, canEditAsFiles: true });
  await pick(desktopApp);
  assert.ok(desktopApp.root.findAll((n) => n.props.href === "/settings#settings-workspace").length > 0);
  assert.equal(desktopApp.root.findAll((n) => n.props.name === "cookies").length, 0);
  await act(async () => desktopApp.unmount());
  const browser = await mount(harness(projectsOk), { canEditAsFiles: false });
  await pick(browser);
  assert.match(text(browser), /needs the WeaveForge desktop app/);
  await act(async () => browser.unmount());
});

test("without sign-in routes there is no connect step and no request", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h, { workshop: false });
  assert.equal(tree.root.findAll((n) => n.props.name === "cookies").length, 0);
  assert.equal(h.calls.length, 0);
  await act(async () => tree.unmount());
});

test("sign-in is offered with an account, and in the Tauri shell even without one", () => {
  assert.equal(canShowWorkshop({ localMode: false }), true);
  assert.equal(canShowWorkshop({ localMode: true }), false);
  assert.equal(canShowWorkshop({ localMode: true, shell: true }), true);
  assert.equal(canShowWorkshop({ localMode: false, shell: true }), true);
});

// ---- One list ----

test("account projects and linked ones form one list; linked first, marked ★", async () => {
  const { gateway } = fakeGateway([report("r1", "p2", "MSc thesis"), report("r2", "p9", "Old draft")]);
  const tree = await mount(harness(projectsOk, SESSION), { gateway });
  const list = rows(tree);
  assert.equal(list.length, 3, "p2 is in the account and linked: one row");
  assert.ok(list[0]!.startsWith("★ ") && list[1]!.startsWith("★ "));
  assert.match(list.find((r) => r.includes("Old draft")) ?? "", /not in the signed-in account/);
  assert.ok(list[2]!.includes("Abstract") && !list[2]!.includes("★"));
  await act(async () => tree.unmount());
});

test("search narrows the list by name and says when nothing matches", async () => {
  const tree = await mount(harness(projectsOk, SESSION));
  const search = tree.root.find((n) => n.type === "input" && n.props.type === "search");
  await type(search, "  ABS ");
  assert.deepEqual(rows(tree).length, 1);
  await type(search, "zzz");
  assert.equal(rows(tree).length, 0);
  assert.match(text(tree), /No projects match/);
  await act(async () => tree.unmount());
});

test("with no projects at all, Export ZIP opens the export", async () => {
  let exported = 0;
  const tree = await mount(harness(() => json({ projects: [] }), SESSION), { onExport: () => { exported++; } });
  assert.match(text(tree), /No Overleaf projects yet/);
  await act(async () => button(tree, "Export ZIP").props.onClick());
  assert.equal(exported, 1);
  await act(async () => tree.unmount());
});

// ---- Settings: which projects show ----

const checkboxes = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === "input" && n.props.type === "checkbox");
const checkbox = (tree: ReactTestRenderer, name: string) =>
  tree.root.find((n) => n.type === "label" && textOf(n).includes(name)).find((n) => n.type === "input");

test("Settings picks which account projects show; linked ones always show; the pick is remembered", async () => {
  const { gateway } = fakeGateway([report("r2", "p9", "Old draft")]);
  const { picks, box } = memoryPicks();
  const tree = await mount(harness(projectsOk, SESSION), { gateway, picks });
  assert.equal(rows(tree).length, 3, "nothing picked yet: all show");
  await act(async () => button(tree, "Settings").props.onClick());
  assert.equal(checkboxes(tree).length, 2, "only unlinked account projects are offered");
  assert.ok(checkboxes(tree).every((c) => c.props.checked));

  await act(async () => button(tree, "Hide all").props.onClick());
  assert.deepEqual(box.ids, []);
  assert.equal(rows(tree).length, 1);
  assert.ok(rows(tree)[0]!.includes("Old draft"));
  assert.match(text(tree), /Showing 1 of 3 projects/);

  await act(async () => checkbox(tree, "Thesis").props.onChange());
  assert.deepEqual(box.ids, ["p2"]);
  assert.equal(rows(tree).length, 2);

  await act(async () => button(tree, "Show all").props.onClick());
  assert.equal(box.ids, null);
  assert.equal(rows(tree).length, 3);
  assert.ok(!text(tree).includes("Showing"));

  await act(async () => button(tree, "Done").props.onClick());
  assert.ok(!text(tree).includes("Signed in to Overleaf"), "Done closes the settings");
  await act(async () => tree.unmount());
});

test("a saved pick applies when the tab opens; unticking one hides it", async () => {
  const { picks, box } = memoryPicks(["p1", "p2"]);
  const tree = await mount(harness(projectsOk, SESSION), { picks });
  assert.equal(rows(tree).length, 2);
  await act(async () => button(tree, "Settings").props.onClick());
  await act(async () => checkbox(tree, "Abstract").props.onChange());
  assert.deepEqual(box.ids, ["p2"]);
  assert.deepEqual(rows(tree).map((r) => r.split("In your")[0]), ["Thesis"]);
  await act(async () => tree.unmount());
});

test("with every project hidden the list says to pick some", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { picks: memoryPicks([]).picks });
  assert.equal(rows(tree).length, 0);
  assert.match(text(tree), /No projects chosen to show/);
  assert.ok(button(tree, "Settings"), "Settings stays reachable");
  await act(async () => tree.unmount());
});

test("signed out there is no Settings button", async () => {
  const tree = await mount(harness(projectsOk));
  assert.equal(buttons(tree, "Settings").length, 0);
  await act(async () => tree.unmount());
});

test("linked projects tuck the connect step into a details block", async () => {
  const { gateway } = fakeGateway([report("r1", "p9", "MSc thesis")]);
  const tree = await mount(harness(projectsOk), { gateway });
  assert.equal(tree.root.findAll((n) => n.type === "details" && n.props.className === "overleaf-conn-details").length, 1);
  assert.deepEqual(rows(tree).length, 1);
  await act(async () => tree.unmount());
});

// ---- Project detail ----

test("tab blockers: Write needs the desktop app, live tabs need sign-in and the account", () => {
  assert.deepEqual(tabBlockers({ signedIn: true, inAccount: true, inShell: true, linked: false }), { write: null, pdf: null, outline: null });
  const browser = tabBlockers({ signedIn: true, inAccount: true, inShell: false, linked: false });
  assert.match(browser.write ?? "", /desktop app/);
  assert.equal(browser.pdf, null);
  const linkedOnly = tabBlockers({ signedIn: false, inAccount: false, inShell: true, linked: true });
  assert.match(linkedOnly.pdf ?? "", /Sign in/);
  assert.equal(linkedOnly.outline, null);
  const elsewhere = tabBlockers({ signedIn: true, inAccount: false, inShell: true, linked: false });
  assert.match(elsewhere.pdf ?? "", /not in the signed-in/);
  assert.match(elsewhere.outline ?? "", /link this project/);
});

test("opening an account project in the browser starts on PDF, with the workspace's headers", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  await openRow(tree, "Thesis");
  const viewer = tree.root.findByType(WorkshopPdfViewer);
  assert.deepEqual(viewer.props, { sessionId: SESSION, projectId: "p2", authHeaders: h.client.authHeaders });
  assert.ok(tree.root.findAll((n) => n.props.href === "https://www.overleaf.com/project/p2").length > 0, "Open in Overleaf");
  await tab(tree, "Write");
  assert.match(text(tree), /Live editing needs the WeaveForge desktop app/);
  await act(async () => button(tree, "All projects").props.onClick());
  assert.equal(rows(tree).length, 2);
  await act(async () => tree.unmount());
});

test("Outline reads live text when signed in, and the git link otherwise", async () => {
  const { gateway, reads } = fakeGateway([report("r1", "p2", "MSc thesis")]);
  const h = harness(projectsOk, SESSION);
  const live = await mount(h, { gateway });
  await openRow(live, "Thesis");
  await tab(live, "Outline");
  await settle();
  assert.ok(h.calls.some((c) => c.url.endsWith("/open")), "the live route was used");
  assert.ok(h.calls.some((c) => c.url.endsWith("/close")), "and closed again");
  assert.equal(reads.length, 0);
  assert.match(text(live), /Live intro/);
  assert.equal(live.root.findByType(OverleafOutline).props.targets.initial["Git intro"], 500, "linked: targets apply");
  await act(async () => live.unmount());

  const git = await mount(harness(projectsOk), { gateway });
  await openRow(git, "MSc thesis");
  await settle();
  assert.deepEqual(reads, ["r1"], "signed out: Outline is the default and reads the git link");
  assert.match(text(git), /From the Git link/);
  await act(async () => git.unmount());
});

test("an unlinked project offers Link prefilled with its name and id", async () => {
  const tree = await mount(harness(projectsOk, SESSION));
  await openRow(tree, "Abstract");
  await act(async () => button(tree, "Link to this project").props.onClick());
  assert.equal(byName(tree, "title").props.defaultValue, "Abstract");
  assert.equal(byName(tree, "overleafProjectId").props.defaultValue, "p1");
  await act(async () => tree.unmount());
});

test("unlinking a project that is not in the account returns to the list", async () => {
  const reports = [report("r1", "p9", "Old draft")];
  const { gateway } = fakeGateway(reports);
  gateway.unlink = async () => { reports.length = 0; };
  const tree = await mount(harness(projectsOk, SESSION), { gateway });
  await openRow(tree, "Old draft");
  await act(async () => button(tree, "Unlink").props.onClick());
  await act(async () => button(tree, "Confirm").props.onClick());
  assert.equal(rows(tree).length, 2);
  assert.ok(!text(tree).includes("Old draft"));
  await act(async () => tree.unmount());
});
