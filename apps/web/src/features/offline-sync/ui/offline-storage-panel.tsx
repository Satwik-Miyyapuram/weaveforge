"use client";

import { useProject } from "@/features/projects";
import { useOfflineStorage } from "./use-offline-storage";

/**
 * Settings → Sync → what this machine keeps offline.
 *
 * PDFs are the only thing here big enough to matter, and a person with forty
 * projects wants the three they are writing from — so the choice is per
 * project, and the space it costs is shown next to it rather than in a
 * separate place they would have to think to visit.
 */
export function OfflineStoragePanel() {
  const { storage, toggle } = useOfflineStorage();
  const { projects } = useProject();
  if (!storage.supported) return null;

  const { bytes, files, quota } = storage.usage;
  const used = Math.min(100, Math.round((bytes / Math.max(1, quota)) * 100));

  return (
    <div className="settings-group">
      <h3>Kept on this device</h3>
      <p className="muted">
        {size(bytes)} of {size(quota)} — {files} {files === 1 ? "file" : "files"}. The oldest
        untouched file goes first when it fills; it downloads again when you open it.
      </p>
      <progress value={bytes} max={quota} aria-label={`${used}% of the offline space used`} />
      {projects.map((project) => {
        const on = storage.projects.includes(project.id);
        return (
          <label key={project.id} className="field-inline">
            <input
              type="checkbox"
              className="themed-check"
              checked={on}
              onChange={() => void toggle(project.id, !on)}
            />
            <span>{project.name}</span>
          </label>
        );
      })}
      {projects.length === 0 && <p className="muted">No projects yet.</p>}
    </div>
  );
}

/** Bytes, as a person reads them. */
function size(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}
