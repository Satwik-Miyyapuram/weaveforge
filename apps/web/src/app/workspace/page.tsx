/**
 * The editor workspace's route. The screen itself is `WorkspaceHost`, which the
 * app shell keeps mounted across routes so coming back from another screen
 * does not rebuild it (`features/editor-workspace/ui/workspace-host.tsx`).
 */
export default function WorkspacePage() {
  return <h1 className="sr-only">Workspace</h1>;
}
