import type { FeatureModule } from "@weaveforge/core";

/**
 * The split-pane editor, in both builds. A browser tab keeps Ctrl-W and
 * Ctrl-N for itself (they close the tab and open a window before the page
 * sees them), so on the web those two commands are reached from the strip
 * and the explorer; everything else the workspace does works the same.
 *
 * No `navGroup`: it sits with Home and Search. `mobile: false` — absent from
 * the phone bar, strip and swipe. A split pane needs width and a pointer; on a
 * phone the same documents are reached by opening them.
 */
export const editorWorkspaceModule: FeatureModule = {
  id: "editor-workspace",
  title: "Editor",
  navItems: [
    { key: "editor-workspace", label: "Editor", path: "/workspace", icon: "pencil", mobile: false },
  ],
  routes: [{ path: "/workspace", component: "editor-workspace/WorkspaceScreen" }],
};
