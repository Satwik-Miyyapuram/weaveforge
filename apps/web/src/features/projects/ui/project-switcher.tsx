"use client";

import { useState } from "react";
import { useProject } from "./project-provider";

/** Header chip showing the current project; dropdown to switch or open the picker. */
export function ProjectSwitcher() {
  const { current, projects, setProject } = useProject();
  const [open, setOpen] = useState(false);
  if (!current) return null;

  return (
    <div className="proj-switcher">
      <button className="proj-chip" onClick={() => setOpen((o) => !o)}>
        <span className="project-dot" style={{ background: current.color ?? "#7c9885" }} />
        <span>{current.name}</span>
        <span className="chev">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </span>
      </button>
      {open && (
        <div className="proj-menu" onMouseLeave={() => setOpen(false)}>
          {projects.map((p) => (
            <button
              key={p.id}
              className={`proj-menu-item${p.id === current.id ? " sel" : ""}`}
              onClick={() => { setProject(p.id); setOpen(false); }}
            >
              <span className="project-dot" style={{ background: p.color ?? "#7c9885" }} />
              {p.name}
              {p.id === current.id && <span className="check">✓</span>}
            </button>
          ))}
          <div className="proj-menu-sep" />
          <button className="proj-menu-item" onClick={() => { setProject(null); setOpen(false); }}>
            ＋  New / all projects
          </button>
        </div>
      )}
    </div>
  );
}
