import type { FeatureModule } from "@weaveforge/core";

/**
 * The split-pane editor, in both builds. A browser tab keeps Ctrl-W and
 * Ctrl-N for itself (they close the tab and open a window before the page
 * sees them), so on the web those two commands are reached from the strip
 * and the explorer; everything else the workspace does works the same.
 *
 * `mobile: false` — it is a destination on the desktop sidebar and absent from
 * the phone bar and strip. A split pane needs width and a pointer; on a phone
 * the same documents are reached by opening them, which is what the strip is
 * for.
 */
export const editorWorkspaceModule: FeatureModule = {
  id: "editor-workspace",
  title: "Editor",
  navGroup: "library",
  navItems: [
    { key: "editor-workspace", label: "Editor", path: "/workspace", icon: "pencil", mobile: false },
  ],
  routes: [{ path: "/workspace", component: "editor-workspace/WorkspaceScreen" }],
};
