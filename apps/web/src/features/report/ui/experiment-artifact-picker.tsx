"use client";

import { useEffect, useState } from "react";
import type { Experiment } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { artifactBasename, serialiseArtifactRef } from "../application/artifact-refs";
import { formatError } from "@/lib/format-error";

/** Collision key matching {@link artifactLabel} / insert serialization. */
function artifactCollisionKey(name: string): string {
  return artifactBasename(name) || name;
}

/** Readable label for an artifact URL/name in the dropdown. */
function artifactLabel(name: string, siblings: readonly string[]): string {
  const base = artifactCollisionKey(name);
  const collisions = siblings.filter((a) => artifactCollisionKey(a) === base);
  if (collisions.length <= 1) return base;
  let host = "";
  try {
    host = new URL(name).hostname;
  } catch {
    /* not a URL */
  }
  const withHost = host ? `${base} (${host})` : base;
  const hostStillCollides =
    host &&
    collisions.filter((a) => {
      try {
        return new URL(a).hostname === host;
      } catch {
        return false;
      }
    }).length > 1;
  if (!host || hostStillCollides) {
    const tail = name.length > 48 ? `…${name.slice(-44)}` : name;
    return `${base} — ${tail}`;
  }
  return withHost;
}

/**
 * `/experiment` picker — inserts an `expartifact:` markdown ref (Phase C4).
 */
export function ExperimentArtifactPicker({
  onInsert,
  disabled = false,
}: {
  onInsert: (markdown: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentId, setExperimentId] = useState("");
  const [artifactName, setArtifactName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    setError(null);
    void getContainer()
      .experiments.loadExperiments()
      .then((list) => {
        if (cancelled) return;
        setExperiments(list);
        const first = list.find((e) => (e.artifacts?.length ?? 0) > 0) ?? list[0];
        if (first) {
          setExperimentId(first.id);
          setArtifactName(first.artifacts?.[0] ?? "");
        } else {
          setExperimentId("");
          setArtifactName("");
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(formatError(err));
          setExperiments([]);
          setExperimentId("");
          setArtifactName("");
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const selected = experiments.find((e) => e.id === experimentId);
  const artifacts = selected?.artifacts ?? [];

  function insert() {
    if (!experimentId || !artifactName.trim()) return;
    const selectedArtifacts = experiments.find((e) => e.id === experimentId)?.artifacts ?? [];
    const base = artifactCollisionKey(artifactName);
    const collisions = selectedArtifacts.filter((a) => artifactCollisionKey(a) === base);
    // On basename collision keep the full URL so resolve can exact-match.
    const name =
      collisions.length > 1 ? artifactName.trim() : base || artifactName.trim();
    onInsert(
      serialiseArtifactRef({
        experimentId,
        artifactName: name,
        alt: artifactCollisionKey(name),
      }),
    );
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        className="link-btn"
        disabled={disabled}
        onClick={() => setOpen(true)}
        title="Insert experiment artifact"
      >
        /experiment
      </button>
    );
  }

  return (
    <div className="experiment-artifact-picker" role="dialog" aria-label="Insert experiment artifact">
      <Select
        aria-label="Experiment"
        value={experimentId}
        disabled={busy || experiments.length === 0}
        onChange={(e) => {
          const id = e.target.value;
          setExperimentId(id);
          const next = experiments.find((item) => item.id === id);
          setArtifactName(next?.artifacts?.[0] ?? "");
        }}
      >
        {experiments.length === 0 ? (
          <option value="">No experiments</option>
        ) : (
          experiments.map((exp) => (
            <option key={exp.id} value={exp.id}>
              {exp.name}
            </option>
          ))
        )}
      </Select>
      <Select
        aria-label="Artifact"
        value={artifactName}
        disabled={busy || artifacts.length === 0}
        onChange={(e) => setArtifactName(e.target.value)}
      >
        {artifacts.length === 0 ? (
          <option value="">No artifacts</option>
        ) : (
          artifacts.map((name) => (
            <option key={name} value={name}>
              {artifactLabel(name, artifacts)}
            </option>
          ))
        )}
      </Select>
      {error && <span className="error">{error}</span>}
      <button type="button" className="link-btn" onClick={() => setOpen(false)} disabled={busy}>
        cancel
      </button>
      <button
        type="button"
        className="btn-primary"
        onClick={insert}
        disabled={busy || !experimentId || !artifactName.trim()}
      >
        Insert
      </button>
    </div>
  );
}
