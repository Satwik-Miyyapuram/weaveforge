"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { explainArm, type RelatedArm } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { useSearchIndex } from "@/lib/use-search-index";

interface RelatedItem {
  id: string;
  title: string;
  href: string;
  kind: string;
  arm: RelatedArm;
}

/**
 * "Related to this" for any entity.
 *
 * The retrieval arm is shown rather than hidden. On a workspace with few links
 * the graph has nothing to say and the results come from wording instead —
 * telling the user that is the difference between "these look weak" and "these
 * look weak *because* I haven't linked much yet", and the second is actionable.
 */
export function RelatedPanel({
  seedKind,
  seedId,
  limit = 6,
}: {
  seedKind: "note" | "paper" | "section";
  seedId: string;
  limit?: number;
}) {
  // This panel genuinely needs the index — it is what "related" is computed
  // from — so it warms it rather than waiting for someone else to.
  const searchIndex = useSearchIndex(true);
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

        const hits = container.search.related(`${seedKind}:${seedId}`, limit);
        const resolved = hits.flatMap((hit) => {
          const [kind, ...rest] = hit.id.split(":");
          const entityId = rest.join(":");
          const doc = container.search.search(entityId, { limit: 1 });
          // Fall back to the id when the document is not in the index — better
          // a plain link than a dropped result.
          const known = doc.find((candidate) => candidate.entityId === entityId);
          return [
            {
              id: hit.id,
              title: known?.title ?? entityId,
              href: known?.href ?? "#",
              kind: kind ?? "note",
              arm: hit.arm,
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

  const arm = items[0]!.arm;

  return (
    <section className="related-panel">
      <h4 className="settings-group">Related</h4>
      <p className="muted jump-to-meta">{explainArm(arm)}</p>
      <ul className="related-panel-list">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={item.href}>{item.title}</Link>
            <span className="jump-to-meta"> · {item.kind}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
