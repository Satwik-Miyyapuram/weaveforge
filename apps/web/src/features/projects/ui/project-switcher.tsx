"use client";

import { useProject } from "./project-provider";
import { showNewProject } from "./projects-screen";
import { Popover } from "@/components/popover";
import { RowButton } from "@/components/controls";

const DOT_TITLE = "Project colour";

/**
 * Header chip showing the current project; the panel switches or opens the picker.
 *
 * Through `Popover`, like the account button. This chip lives in the sidebar's
 * bottom block, which is a scroll container: a panel positioned inside it was
 * clipped by that container and pinned to it. Portalled out and placed by
 * measurement, it drops down when there is room below the chip and flips up when
 * there is not — which is the whole point of the shared control.
 */
export function ProjectSwitcher() {
  const { current, projects, setProject } = useProject();
  if (!current) return null;

  return (
    <div className="proj-switcher">
      <Popover
        portal
        align="left"
        ariaLabel={`Project: ${current.name}`}
        triggerClassName="proj-chip"
        label={
          <>
            <span className="project-dot" aria-hidden title={DOT_TITLE} style={{ background: current.color ?? "#7c9885" }} />
            <span title={current.name}>{current.name}</span>
          </>
        }
      >
        {(close) => (
          <>
            {projects.map((p) => (
              <RowButton
                key={p.id}
                className={`proj-menu-item${p.id === current.id ? " sel" : ""}`}
                aria-current={p.id === current.id || undefined}
                data-autofocus={p.id === current.id || undefined}
                onClick={() => {
                  setProject(p.id);
                  close();
                }}
              >
                <span className="project-dot" aria-hidden title={DOT_TITLE} style={{ background: p.color ?? "#7c9885" }} />
                {p.name}
                {p.id === current.id && <span className="check">✓</span>}
              </RowButton>
            ))}
            <div className="proj-menu-sep" />
            {[
              { label: "＋ New project", run: () => showNewProject(setProject) },
              { label: "All projects", run: () => setProject(null) },
            ].map((row) => (
              <RowButton
                key={row.label}
                className="proj-menu-item"
                onClick={() => {
                  row.run();
                  close();
                }}
              >
                {row.label}
              </RowButton>
            ))}
          </>
        )}
      </Popover>
    </div>
  );
}