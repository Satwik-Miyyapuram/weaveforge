"use client";

import { useState } from "react";
import type { LatexSectionNode } from "@weaveforge/core";
import { ChevronIcon } from "@/components/chevron-icon";
import { sectionTargetKeys } from "../lib/section-target-keys";
import { sectionBody, type SourceFile } from "../lib/section-word-counts";

/** Collapsible section hierarchy; each heading opens to its own LaTeX body. */
export function SectionTree({ roots, files, counts, targets, onSetTarget, parentPath = [] }: {
  roots: LatexSectionNode[];
  files: readonly SourceFile[];
  counts: ReadonlyMap<string, number>;
  targets: Record<string, number>;
  onSetTarget: (key: string, words: number | null) => void;
  parentPath?: readonly string[];
}) {
  if (!roots.length) return <p className="muted">No static section commands were found.</p>;
  const keys = sectionTargetKeys(parentPath, roots);
  return <div className="linked-overleaf-tree">{roots.map((node, index) => (
    <SectionNode key={node.id} node={node} files={files} counts={counts} targets={targets} onSetTarget={onSetTarget} targetKey={keys[index]!} />
  ))}</div>;
}

function SectionNode({ node, files, counts, targets, onSetTarget, targetKey: key }: {
  node: LatexSectionNode;
  files: readonly SourceFile[];
  counts: ReadonlyMap<string, number>;
  targets: Record<string, number>;
  onSetTarget: (key: string, words: number | null) => void;
  targetKey: string;
}) {
  const [editingTarget, setEditingTarget] = useState(false);
  const body = sectionBody(node, files);
  const hasBody = body.length > 0;
  const hasChildren = node.children.length > 0;
  const words = counts.get(node.id) ?? 0;
  const target = targets[key];
  const pct = target ? Math.min(100, Math.round((words / target) * 100)) : 0;

  function saveTarget(raw: string) {
    setEditingTarget(false);
    const trimmed = raw.trim();
    if (!trimmed) { if (target) onSetTarget(key, null); return; }
    const n = Number(trimmed);
    if (Number.isInteger(n) && n > 0) onSetTarget(key, n);
  }

  return (
    <details className="linked-overleaf-section" data-level={node.level}>
      <summary>
        <ChevronIcon variant="expand" size={14} />
        <span className="linked-overleaf-section__title">{node.title || <em>(untitled)</em>}</span>
        <span className="linked-overleaf-section__count">
          {target ? `${words.toLocaleString()} / ${target.toLocaleString()} words` : `${words.toLocaleString()} words`}
        </span>
        <small>{node.command} · {node.file}:{node.startLine}</small>
      </summary>
      <div className="linked-overleaf-section__body">
        {target && (
          <div className="linked-overleaf-section__progress" title={`${pct}% of target`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
        <div className="linked-overleaf-section__target">
          {editingTarget ? (
            <input
              type="number" min={1} autoFocus className="linked-overleaf-target-input"
              defaultValue={target ?? ""}
              placeholder="Target words"
              onBlur={(e) => saveTarget(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveTarget((e.target as HTMLInputElement).value); if (e.key === "Escape") setEditingTarget(false); }}
            />
          ) : (
            <button type="button" className="link-btn" onClick={() => setEditingTarget(true)}>
              {target ? "Edit target" : "Set target"}
            </button>
          )}
          {target && !editingTarget && (
            <button type="button" className="link-btn" onClick={() => onSetTarget(key, null)}>Clear</button>
          )}
        </div>
        {hasBody ? <pre>{body}</pre> : <p className="muted">No text directly under this heading.</p>}
        {hasChildren && <SectionTree roots={node.children} files={files} counts={counts} targets={targets} onSetTarget={onSetTarget} parentPath={[key]} />}
      </div>
    </details>
  );
}
