"use client";

import { useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "./project-provider";
import { useSubmit } from "@/lib/hooks/use-submit";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { EmptyState } from "@/components/empty-state";
import { WeaveForgeLogo } from "@/components/weave-forge-logo";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { loadLocalDemoWorkspace } from "@/features/showcase/application/load-local-demo";
import dynamic from "next/dynamic";

// Lazy: this screen sits in the root layout, which has a tight JS budget.
const ConfirmDialog = dynamic(() => import("@/components/confirm-dialog").then((m) => m.ConfirmDialog), { ssr: false });
const EntityCardMenu = dynamic(() => import("@/components/entity-card-menu").then((m) => m.EntityCardMenu), { ssr: false });

/**
 * Project picker / creator. Shown when no project is selected. Choosing a
 * project scopes the whole app to it.
 */
export function ProjectsScreen() {
  const { projects, loading, current, setProject, refresh } = useProject();
  const [name, setName] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const local = isLocalMode();

  const { busy, error, submit: create } = useSubmit(async () => {
    const p = await getContainer().projects.manageProject.create({ name });
    await refresh();
    setName("");
    setAddOpen(false);
    setProject(p.id);
  });

  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const { busy: removeBusy, error: removeError, submit: remove } = useSubmit(async () => {
    if (!removing) return;
    await getContainer().projects.manageProject.remove(removing.id);
    await removeLocalFolder(removing);
    if (current?.id === removing.id) setProject(null);
    setRemoving(null);
    await refresh();
  });

  // The no-account copy starts empty. A filled workspace shows what every
  // screen looks like without the visitor first entering thirty papers.
  const { busy: demoBusy, error: demoError, submit: loadDemo } = useSubmit(async () => {
    const { projectId } = await loadLocalDemoWorkspace();
    await refresh();
    setProject(projectId);
  });
  const demoButton = local ? (
    <button type="button" className="btn-secondary" disabled={demoBusy} onClick={() => void loadDemo()}>
      {demoBusy ? "Loading demo…" : "Load demo workspace"}
    </button>
  ) : null;

  return (
    <section className="screen">
      <ScreenHead>
        {demoButton}
        <button className="btn-primary" onClick={() => setAddOpen(true)}>New project</button>
      </ScreenHead>

      {demoError && <FormError>{demoError}</FormError>}
      {removeError && <FormError>{removeError}</FormError>}
      {removing && (
        <ConfirmDialog
          title={`Delete "${removing.name}"?`}
          body="Its papers, Notes, tags, runs and report go with it, on every device. This cannot be undone."
          confirmLabel="Delete project"
          danger
          busy={removeBusy}
          onConfirm={() => void remove()}
          onClose={() => setRemoving(null)}
        />
      )}

      {addOpen && (
        <Modal title="New project" onClose={() => setAddOpen(false)}>
          <form className="add-form" onSubmit={create}>
            <div className="field">
              <label htmlFor="pname">Name</label>
              <input
                id="pname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Latent Spaces Thesis"
                autoFocus
                required
              />
            </div>
            {error && <FormError>{error}</FormError>}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Creating…" : "Create project"}
            </button>
          </form>
        </Modal>
      )}

      {loading && <ScreenLoader status="Loading projects…" />}

      {!loading && projects.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<WeaveForgeLogo className="app-logo" />}
          title="No projects yet"
          body="A project is one piece of research: a thesis, a paper, a lab rotation. Everything you add — papers, notes, runs, the report — belongs to one, and switching projects switches the whole workspace."
          action={
            <>
              <button type="button" className="btn-primary" onClick={() => setAddOpen(true)}>
                + New project
              </button>
              {demoButton}
            </>
          }
        />
      )}

      {!loading && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id} className="project-row">
              {/*
               * A real `<button>`, not a `<li>` with an `onClick`. This is the
               * first screen a signed-in user with no project sees, and the
               * clickable list item could not be reached by keyboard or
               * activated with Enter or Space — no `role`, no `tabIndex`, no
               * key handler. A button gets the role, the focus ring and both
               * activation keys for free.
               */}
              <button
                type="button"
                className="card project-card"
                onClick={() => setProject(p.id)}
              >
                <span className="project-dot" style={{ background: p.color ?? "#7c9885" }} />
                <span className="project-name">{p.name}</span>
              </button>
              <EntityCardMenu
                shareable={false}
                title={p.name}
                onDelete={() => setRemoving(p)}
                deleteLabel="Delete project"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Delete the project's workspace folder too; the row is already gone, so a failure only warns. */
async function removeLocalFolder(project: { id: string; name: string }): Promise<void> {
  const [{ activeWorkspaceFs }, { removeProjectFolder }] = await Promise.all([
    import("@/features/workspace/application/workspace-folder"),
    import("@/features/workspace/application/remove-project-folder"),
  ]);
  const fs = activeWorkspaceFs();
  if (!fs) return;
  await removeProjectFolder(fs, project).catch((e) => console.warn("project folder not removed", e));
}
