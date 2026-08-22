"use client";

import { useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "./project-provider";
import { formatError } from "@/lib/format-error";
import { ScreenHead } from "@/components/screen-head";

/**
 * Project picker / creator. Shown when no project is selected. Choosing a
 * project scopes the whole app to it.
 */
export function ProjectsScreen() {
  const { projects, loading, setProject, refresh } = useProject();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await getContainer().projects.manageProject.create({ name });
      await refresh();
      setName("");
      setAddOpen(false);
      setProject(p.id);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

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
