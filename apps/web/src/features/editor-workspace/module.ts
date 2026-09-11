import type { FeatureModule } from "@weaveforge/core";

/**
 * The split-pane editor. Desktop only: a browser tab cannot give up Ctrl-W
 * and Ctrl-P, and the served build would otherwise carry a nav entry to a
 * screen that only explains why it is not there.
 */
export const editorWorkspaceModule: FeatureModule = {
  id: "editor-workspace",
  title: "Editor",
  navGroup: "library",
  navItems: [{ key: "editor-workspace", label: "Editor", path: "/workspace", icon: "pencil" }],
  routes: [{ path: "/workspace", component: "editor-workspace/WorkspaceScreen" }],
  desktopOnly: true,
};
