import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";
import type { LinkedReport } from "../ui/linked-overleaf-api";
import { OverleafWorkspace } from "../ui/overleaf-workspace";
import type { ProjectPicksStore } from "../ui/overleaf-project-picks";
import { tabBlockers } from "../ui/overleaf-project-detail";
import type { LinkedReportsGateway } from "../ui/use-linked-reports";
import { canShowWorkshop, type WorkshopSessionStore } from "../ui/use-workshop-session";
import { WorkshopPdfViewer } from "../ui/workshop-pdf-viewer";
import { navFoldSnapshot } from "@/lib/hooks/use-nav-fold";

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

function fakeGateway(reports: LinkedReport[] = []) {
  const gateway: LinkedReportsGateway = {
    list: async () => [...reports],
    unlink: async () => {},
  };
  return { gateway };
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
  onlyProjectId?: string;
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
/** The project list's cards. */
const cards = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === "li" && String(n.props.className).includes("overleaf-card"));
/** A card's title and meta line, as text. */
const cardText = (card: ReactTestInstance) =>
  card.findAll((n) => n.type === "h3" || (n.type === "p" && n.props.className === "entity-card-meta")).map(textOf).join("");
/** The project list's rows, as their text. */
const rows = (tree: ReactTestRenderer) => cards(tree).map(cardText);
const openRow = async (tree: ReactTestRenderer, name: string) => {
  const card = cards(tree).find((n) => cardText(n).includes(name));
  assert.ok(card, `a card for "${name}"`);
  await act(async () => card.props.onClick());
};
const tab = async (tree: ReactTestRenderer, label: string) => {
  const found = tree.root.find((n) => n.type === "button" && n.props.role === "tab" && textOf(n) === label);
  await act(async () => found.props.onClick());
};
/** Opens the ⋯ account menu. Its outside-click hook listens on `document`, which node lacks. */
const openMenu = async (tree: ReactTestRenderer) => {
  (globalThis as { document?: unknown }).document ??= { addEventListener() {}, removeEventListener() {}, activeElement: null, body: {} };
  const trigger = tree.root.find((n) => n.type === "button" && n.props["aria-label"] === "Overleaf account");
  await act(async () => trigger.props.onClick({ detail: 0 }));
};
/** Opens the ⋯ account menu and picks one item. */
const menuPick = async (tree: ReactTestRenderer, label: string) => {
  await openMenu(tree);
  const item = tree.root.find((n) => n.type === "button" && String(n.props.role ?? "").startsWith("menuitem") && textOf(n).includes(label));
  await act(async () => item.props.onClick());
};

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
  await openMenu(tree);
  assert.match(text(tree), /Signed in to Overleaf/, "the account line lives in the ⋯ menu");
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
  await menuPick(tree, "Disconnect");
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

test("with no projects at all, Export for Overleaf opens the export", async () => {
  let exported = 0;
  const tree = await mount(harness(() => json({ projects: [] }), SESSION), { onExport: () => { exported++; } });
  assert.match(text(tree), /No Overleaf projects yet/);
  await act(async () => button(tree, "Export for Overleaf").props.onClick());
  assert.equal(exported, 1);
  await act(async () => tree.unmount());
});

// ---- Choose projects: which ones show ----

const checkboxes = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === "input" && n.props.type === "checkbox");
const checkbox = (tree: ReactTestRenderer, name: string) =>
  tree.root.find((n) => n.type === "label" && textOf(n).includes(name)).find((n) => n.type === "input");

test("Choose projects turns the list into checkboxes; linked ones stay ticked; Done saves", async () => {
  const { gateway } = fakeGateway([report("r2", "p9", "Old draft")]);
  const { picks, box } = memoryPicks();
  const tree = await mount(harness(projectsOk, SESSION), { gateway, picks });
  assert.equal(rows(tree).length, 3, "nothing picked yet: all show");
  await act(async () => button(tree, "Choose projects").props.onClick());
  assert.equal(rows(tree).length, 0, "the rows became checkboxes");
  assert.equal(checkboxes(tree).length, 3);
  assert.ok(checkboxes(tree).every((c) => c.props.className === "wf-check" && c.props.checked));
  assert.equal(checkbox(tree, "Old draft").props.disabled, true, "linked: always shown");

  await act(async () => checkbox(tree, "Abstract").props.onChange());
  assert.equal(box.ids, null, "nothing saved before Done");
  await act(async () => button(tree, "Done").props.onClick());
  assert.deepEqual(box.ids, ["p2"]);
  assert.equal(rows(tree).length, 2);
  assert.match(text(tree), /1 hidden/);

  await act(async () => button(tree, "Choose projects").props.onClick());
  await act(async () => button(tree, "All").props.onClick());
  await act(async () => button(tree, "Done").props.onClick());
  assert.equal(box.ids, null, "all ticked: back to showing everything");
  assert.equal(rows(tree).length, 3);
  await act(async () => tree.unmount());
});

test("Cancel drops the changes", async () => {
  const { picks, box } = memoryPicks(["p1", "p2"]);
  const tree = await mount(harness(projectsOk, SESSION), { picks });
  await act(async () => button(tree, "Choose projects").props.onClick());
  await act(async () => button(tree, "None").props.onClick());
  assert.ok(checkboxes(tree).every((c) => !c.props.checked));
  await act(async () => button(tree, "Cancel").props.onClick());
  assert.deepEqual(box.ids, ["p1", "p2"]);
  assert.equal(rows(tree).length, 2);
  await act(async () => tree.unmount());
});

test("a saved pick applies when the tab opens", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { picks: memoryPicks(["p2"]).picks });
  assert.deepEqual(rows(tree).map((r) => r.split("In your")[0]), ["Thesis"]);
  await act(async () => tree.unmount());
});

test("with every project hidden the list says to choose some", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { picks: memoryPicks([]).picks });
  assert.equal(rows(tree).length, 0);
  assert.match(text(tree), /No projects shown/);
  assert.ok(button(tree, "Choose projects"), "Choose projects stays reachable");
  await act(async () => tree.unmount());
});

test("signed out there is no Choose projects button", async () => {
  const tree = await mount(harness(projectsOk));
  assert.equal(buttons(tree, "Choose projects").length, 0);
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

test("tab blockers: Write needs the desktop app, both tabs need sign-in and the account", () => {
  assert.deepEqual(tabBlockers({ signedIn: true, inAccount: true, inShell: true }), { write: null, pdf: null });
  const browser = tabBlockers({ signedIn: true, inAccount: true, inShell: false });
  assert.match(browser.write ?? "", /desktop app/);
  assert.equal(browser.pdf, null);
  const signedOut = tabBlockers({ signedIn: false, inAccount: false, inShell: true });
  assert.match(signedOut.pdf ?? "", /Sign in/);
  const elsewhere = tabBlockers({ signedIn: true, inAccount: false, inShell: true });
  assert.match(elsewhere.pdf ?? "", /not in the signed-in/);
});

/** The layout switch's tab labels; empty when there is no switch. */
const layoutTabs = (tree: ReactTestRenderer) =>
  tree.root.findAll((n) => n.type === "button" && n.props.role === "tab").map(textOf);

test("opening an account project in the browser shows the PDF and says editing needs the desktop app", async () => {
  const h = harness(projectsOk, SESSION);
  const tree = await mount(h);
  await openRow(tree, "Thesis");
  const viewer = tree.root.findByType(WorkshopPdfViewer);
  assert.deepEqual(viewer.props, { sessionId: SESSION, projectId: "p2", authHeaders: h.client.authHeaders });
  assert.ok(tree.root.findAll((n) => n.props.href === "https://www.overleaf.com/project/p2").length > 0, "Open in Overleaf");
  assert.match(text(tree), /Live editing needs the WeaveForge desktop app/);
  assert.deepEqual(layoutTabs(tree), [], "no layout switch without the editor");
  await act(async () => button(tree, "Overleaf").props.onClick());
  assert.equal(rows(tree).length, 2);
  await act(async () => tree.unmount());
});

test("in the desktop app a project opens split, with no layout switch: the divider arrows fold panes", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { inShell: true });
  await openRow(tree, "Thesis");
  assert.deepEqual(layoutTabs(tree), []);
  assert.doesNotMatch(text(tree), /desktop app/);
  await act(async () => tree.unmount());
});

test("in the desktop app the editor fills the page: no record header; Open and Link sit in its toolbar", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { inShell: true });
  await openRow(tree, "Thesis");
  assert.doesNotMatch(text(tree), /In your Overleaf account|Project p2/);
  assert.equal(tree.root.findAll((n) => n.type === "h1").length, 0);
  const [editor] = tree.root.findAll((n) => typeof n.type !== "string" && n.props.toolbar !== undefined && n.props.onHome);
  assert.ok(editor, "the live editor gets toolbar buttons and a home action");
  let inToolbar: ReactTestRenderer | undefined;
  await act(async () => { inToolbar = create(createElement("div", null, editor.props.toolbar)); });
  assert.match(text(inToolbar!), /Open in Overleaf/);
  assert.match(text(inToolbar!), /Link to this project/);
  await act(async () => tree.unmount());
});

test("the live editor folds the app nav while it is open; the browser view does not", async () => {
  const live = await mount(harness(projectsOk, SESSION), { inShell: true });
  await openRow(live, "Thesis");
  assert.equal(navFoldSnapshot(), true);
  await act(async () => live.unmount());
  assert.equal(navFoldSnapshot(), false);
  const web = await mount(harness(projectsOk, SESSION));
  await openRow(web, "Thesis");
  assert.equal(navFoldSnapshot(), false);
  await act(async () => web.unmount());
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

// ---- One project, opened from the editor's sidebar ----

test("opened for one project it shows that project straight away: no cards, no back button", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { inShell: true, onlyProjectId: "p2" });
  assert.equal(cards(tree).length, 0);
  assert.equal(buttons(tree, "Choose projects").length, 0);
  const [editor] = tree.root.findAll((n) => typeof n.type !== "string" && n.props.toolbar !== undefined && n.props.onHome);
  assert.ok(editor, "the live editor for the project");
  assert.equal(editor.props.projectId, "p2");
  await act(async () => tree.unmount());
});

test("opened for one project in the browser it has no back button to a list", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { onlyProjectId: "p2" });
  assert.equal(cards(tree).length, 0);
  assert.equal(buttons(tree, "Overleaf").length, 0);
  assert.match(text(tree), /Thesis/);
  await act(async () => tree.unmount());
});

test("opened for one project that the account no longer has, it says so", async () => {
  const tree = await mount(harness(projectsOk, SESSION), { onlyProjectId: "gone" });
  assert.equal(cards(tree).length, 0);
  assert.match(text(tree), /not in your Overleaf account/);
  await act(async () => tree.unmount());
});

test("opened for one project while signed out, it offers to connect and lists nothing", async () => {
  const tree = await mount(harness(projectsOk), { onlyProjectId: "p2" });
  assert.equal(cards(tree).length, 0);
  assert.ok(tree.root.findAll((n) => n.props.name === "cookies").length > 0, "the connect step");
  await act(async () => tree.unmount());
});
