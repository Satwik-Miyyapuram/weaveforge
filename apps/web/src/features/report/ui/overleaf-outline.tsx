"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import type { LiveOutline } from "@/features/overleaf/application/live-outline";
import { sectionWordCounts } from "../lib/section-word-counts";
import { SectionTree } from "./overleaf-section-tree";
import { ProjectChecks } from "./project-checks";

/** Word targets of a linked project: shown, and saved back to its link. */
export interface OutlineTargets {
  initial: Record<string, number>;
  save: (next: Record<string, number>) => Promise<boolean>;
}

/**
 * A project's sections with word counts, checks and (for linked projects) word
 * targets. `load` reads the sources: through the sign-in session or the git token.
 */
export function OverleafOutline({ load, targets, source }: {
  load: () => Promise<LiveOutline>;
  targets: OutlineTargets | null;
  /** One line saying where the text came from. */
  source: string;
}) {
  const [content, setContent] = useState<LiveOutline | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [values, setValues] = useState<Record<string, number>>(() => targets?.initial ?? {});

  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError("");
    load().then(
      (next) => { if (!cancelled) setContent(next); },
      (err: unknown) => { if (!cancelled) setError(formatError(err)); },
    );
    return () => { cancelled = true; };
  }, [load, attempt]);

  async function setTarget(key: string, words: number | null) {
    if (!targets) return;
    const next = { ...values };
    if (words == null) delete next[key];
    else next[key] = words;
    const prev = values;
    setValues(next); // optimistic
    if (!(await targets.save(next))) setValues(prev);
  }

  const counts = content ? sectionWordCounts(content.sectionTree.roots, content.files) : null;
  const total = content && counts ? content.sectionTree.roots.reduce((sum, node) => sum + (counts.get(node.id) ?? 0), 0) : 0;

  return (
    <div className="overleaf-outline">
      <div className="linked-overleaf-sections-head">
        <span className="muted">{source}</span>
        {content && <span className="linked-overleaf-total">{total.toLocaleString()} words</span>}
        <Button variant="ghost" size="sm" disabled={!content && !error} onClick={() => setAttempt((n) => n + 1)}>Refresh</Button>
      </div>
      {error && <FormError>{error}</FormError>}
      {!content && !error && <p className="muted" role="status">Reading the project…</p>}
      {content && counts && (
        <>
          {content.sectionTree.warnings.length > 0 && <p className="warning">{content.sectionTree.warnings.join(" ")}</p>}
          <ProjectChecks files={content.files} entryFile={content.entryFile} />
          {!targets && <p className="muted">Link this project to set word targets per section.</p>}
          <SectionTree
            roots={content.sectionTree.roots}
            files={content.files}
            counts={counts}
            targets={values}
            onSetTarget={(key, words) => void setTarget(key, words)}
          />
          <details className="linked-overleaf-source">
            <summary>View {content.entryFile}</summary>
            <pre>{content.files.find((file) => file.path === content.entryFile)?.content ?? "Entry file unavailable."}</pre>
          </details>
        </>
      )}
    </div>
  );
}
