"use client";

import { useState } from "react";
import { useProject } from "./project-provider";
import { ChevronIcon } from "@/components/chevron-icon";

/** Header chip showing the current project; dropdown to switch or open the picker. */
export function ProjectSwitcher() {
  const { current, projects, setProject } = useProject();
  const [open, setOpen] = useState(false);
  if (!current) return null;

  return (
    <div className="proj-switcher">
      <button
        type="button"
        className="proj-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="project-dot" style={{ background: current.color ?? "#7c9885" }} />
        <span>{current.name}</span>
        <ChevronIcon />
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
