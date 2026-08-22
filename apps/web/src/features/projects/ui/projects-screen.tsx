"use client";

import { useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "./project-provider";
import { useSubmit } from "@/lib/hooks/use-submit";

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
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            <button className="btn-primary" onClick={() => setAddOpen(true)}>+ New project</button>
          </div>
        </div>
      </header>

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
            {error && <p className="error">{error}</p>}
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
            <li
              key={p.id}
              className="card project-card"
              onClick={() => setProject(p.id)}
            >
              <span className="project-dot" style={{ background: p.color ?? "#7c9885" }} />
              <span className="project-name">{p.name}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
