"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { explainArm, type RelatedArm } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { semanticEnabled, semanticSupported } from "@/features/search/application/semantic-search";
import { useHybridSearchIndex } from "@/lib/hooks/use-search-index";

interface RelatedItem {
  id: string;
  title: string;
  href: string;
  kind: string;
  arms: readonly RelatedArm[];
  /** Cosine similarity to the seed, when the meaning arm found it. */
  similarity?: number;
}

/** What each method is called next to an entry — short, since it sits on every row. */
const ARM_LABEL: Record<RelatedArm, string> = {
  graph: "linked",
  lexical: "similar wording",
  semantic: "similar meaning",
  tags: "shared tags",
  none: "",
};

/** Which methods ran, for the line under the heading. */
function methodsLine(items: readonly RelatedItem[]): string {
  const used = new Set(items.flatMap((item) => item.arms));
  if (used.size === 1) return explainArm([...used][0]!);
  const parts: string[] = [];
  if (used.has("graph")) parts.push("links between your notes and papers");
  if (used.has("semantic")) parts.push("similar meaning");
  if (used.has("lexical")) parts.push("similar wording");
  if (used.has("tags")) parts.push("shared tags");
  return `Found by ${parts.join(", ").replace(/, ([^,]*)$/, " and $1")}`;
}

/**
 * "Related to this" for any entity.
 *
 * The retrieval method is shown rather than hidden, per entry and in sum. On a workspace with few links
 * the graph has nothing to say and the results come from wording instead —
 * telling the user that is the difference between "these look weak" and "these
 * look weak *because* I haven't linked much yet", and the second is actionable.
 */
export function RelatedPanel({
  seedKind,
  seedId,
  limit = 6,
  variant = "panel",
}: {
  seedKind: "note" | "paper" | "section";
  seedId: string;
  limit?: number;
  /** `record`: the side column of a record page — titles with a similarity bar. */
  variant?: "panel" | "record";
}) {
  // This panel genuinely needs the index — it is what "related" is computed
  // from — so it warms it rather than waiting for someone else to.
  // `searchHybrid` changes identity when the semantic arm attaches, which is
  // what re-runs the lookup below with it.
  const { searchHybrid: searchIndex } = useHybridSearchIndex(true);
  const [items, setItems] = useState<RelatedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // `searchIndex` changes identity once the index is warm; that is the
    // signal to compute, since related-lookup needs the graph it builds.
    void (async () => {
      try {
        const container = getContainer();
        await container.search.ensure();
        if (cancelled) return;

        // Graph first, then meaning (when the reader turned semantic search on),
        // then wording — see `WorkspaceSearch.relatedHybrid`.
        const hits = await container.search.relatedHybrid(`${seedKind}:${seedId}`, limit);
        if (cancelled) return;
        const resolved = hits.flatMap((hit) => {
          // The index holds the title and the link; look the document up by
          // its own id. A result whose document is gone is dropped rather than
          // rendered as its uuid, which named nothing a reader could use.
          const doc = container.search.hitById(hit.id);
          if (!doc) return [];
          return [
            {
              id: hit.id,
              title: doc.title,
              href: doc.href,
              kind: doc.kind,
              arms: hit.arms?.length ? hit.arms : [hit.arm],
              similarity: hit.similarity,
            },
          ];
        });
        if (!cancelled) setItems(resolved);
      } catch {
        if (!cancelled) setItems([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [seedKind, seedId, limit, searchIndex]);

  if (items === null) return null;
  if (items.length === 0) return null;

  // Meaning is an arm the reader turns on; when it is off, say so where its
  // absence shows, rather than leaving them to wonder why only links count.
  const meaningOff = semanticSupported() && !semanticEnabled();

  if (variant === "record") {
    const bySimilarity = items.some((item) => item.similarity !== undefined);
    return (
      <section className="record-section">
        <h2 className="record-section-head">
          <span>Related</span>
          <span className="record-section-tag">{bySimilarity ? "By similarity" : "By links and wording"}</span>
        </h2>
        <ul className="record-related">
          {items.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="record-related-title">{item.title}</Link>
              {item.similarity !== undefined ? (
                <span className="record-related-score" title={item.arms.map((arm) => ARM_LABEL[arm]).filter(Boolean).join(" + ")}>
                  <span className="record-bar-track" aria-hidden>
                    <span className="record-bar-fill" style={{ width: `${Math.round(Math.max(0, Math.min(1, item.similarity)) * 100)}%` }} />
                  </span>
                  <span className="record-mono">{Math.round(item.similarity * 100)}%</span>
                </span>
              ) : (
                <span className="record-mono record-related-arm">
                  {item.arms.map((arm) => ARM_LABEL[arm]).filter(Boolean).join(" + ") || item.kind}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="record-footnote">
          {methodsLine(items)}.
          {meaningOff && (
            <>
              {" "}Turn on <Link href="/settings#settings-search">search by meaning</Link> to add things about the same
              idea in other words.
            </>
          )}
        </p>
      </section>
    );
  }

  return (
    <section className="related-panel">
      <h4 className="settings-group">Related</h4>
      <p className="muted jump-to-meta">{methodsLine(items)}</p>
      <ul className="related-panel-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href}>{item.title}</Link>
            <span className="jump-to-meta">
              {" "}
              · {item.kind}
              {item.arms.some((arm) => ARM_LABEL[arm]) &&
                ` · ${item.arms.map((arm) => ARM_LABEL[arm]).filter(Boolean).join(" + ")}`}
            </span>
          </li>
        ))}
      </ul>
      {meaningOff && (
        <p className="muted jump-to-meta">
          Turn on <Link href="/settings#settings-search">search by meaning</Link> to also list things about the same
          idea in different words.
        </p>
      )}
    </section>
  );
}
