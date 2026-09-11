"use client";

import { useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "./project-provider";
import { useSubmit } from "@/lib/hooks/use-submit";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";

/**
 * Project picker / creator. Shown when no project is selected. Choosing a
 * project scopes the whole app to it.
 */
export function ProjectsScreen() {
  const { projects, loading, setProject, refresh } = useProject();
  const [name, setName] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  const { busy, error, setError, submit: create } = useSubmit(async () => {
    const p = await getContainer().projects.manageProject.create({ name });
    await refresh();
    setName("");
    setAddOpen(false);
    setProject(p.id);
  });

  return (
    <section className="screen">
      <ScreenHead>
        <button className="btn-primary" onClick={() => setAddOpen(true)}>+ New project</button>
      </ScreenHead>

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
        <div className="empty">
          <p>No projects yet. Use “New project” to create your first one.</p>
        </div>
      )}

      {!loading && projects.length > 0 && (
        <ul className="project-list">
          {projects.map((p) => (
            <li key={p.id}>
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
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
