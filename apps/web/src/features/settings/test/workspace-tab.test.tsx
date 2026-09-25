import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * The Workspace settings tab's structure and its claims.
 *
 * Written because the panel cannot be checked in the running app on this
 * machine: the API refuses this origin (CORS, `fix/cors-refusal-message`), so
 * the settings screen renders an error card instead of any tab. A render test is
 * weaker than looking at it, and it is much stronger than claiming it works.
 *
 * Two kinds of assertion, and the second is the one that matters:
 *
 *   - **Structure**: a status grid, section headings, the actions that should be
 *     reachable.
 *   - **Claims**: the tab used to say "both live in the folder you choose" while
 *     the section below it said the database was in the app's own directory. A
 *     settings screen that contradicts itself about where your data is is worse
 *     than one that says too little, so the contradiction is pinned here.
 */
describe("the Workspace settings tab", () => {
  it("renders without needing a desktop shell or a database", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    assert.ok(html.length > 0);
    assert.match(html, /id="settings-workspace"/);
    assert.match(html, /aria-labelledby="settings-tab-workspace"/);
  });

  it("opens with a status grid rather than prose", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    // The grid the Account tab established, reused so the two tabs agree.
    assert.match(html, /<dl class="account-info-grid">/);
    // Each pair wrapped in a real element: `display: contents` is what makes the
    // two columns, and a fragment would silently drop to one.
    assert.match(html, /<div class="account-info-row"><dt>Folder<\/dt>/);
  });

  it("names each group of actions with a heading", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    assert.match(html, /<h3 class="settings-group">Workspace<\/h3>/);
    assert.match(html, /<h4 class="settings-group">Folder<\/h4>/);
    assert.match(html, /<h4 class="settings-group">Bring changes back in<\/h4>/);
  });

  it("does not claim the database is inside the workspace folder", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    // The exact contradiction the rewrite removes. It was true for one commit,
    // the move was reverted for destroying data, and the copy outlived it.
    assert.doesNotMatch(html, /Both live in the folder you choose/i);
    assert.doesNotMatch(html, /database[^<]{0,60}inside that folder/i);
  });

  it("says the database is backed up separately from the folder", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    // The honest statement, and the one a reader backing up their work needs.
    assert.match(html, /backed up separately/i);
  });

  it("offers the folder chooser and the ZIP import before anything is connected", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    // ZIP import must not be gated on a connected folder: it is how somebody
    // brings a workspace back without one.
    assert.match(html, /Import a ZIP/);
    // "Check for changes" is the mirror's other half and needs a folder, so it
    // is absent here — the assertion is that its absence is deliberate.
    assert.doesNotMatch(html, /Check for changes/);
  });

  it("keeps the mirror description consistent with a one-way, automatic mirror", async () => {
    const { WorkspaceFolderPanel } = await import("../ui/workspace-folder-panel");
    const html = renderToStaticMarkup(createElement(WorkspaceFolderPanel));

    assert.match(html, /mirrored to the folder as\s+Markdown/i);
    assert.doesNotMatch(html, /the database follows it/i);
  });
});
