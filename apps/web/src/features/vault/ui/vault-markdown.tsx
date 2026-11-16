"use client";

import { useEffect, useMemo } from "react";
import { ShikiMarkdown } from "@/components/markdown/shiki-markdown";
import { readyCore } from "@/lib/rust-core";
import { useVaultImageSource } from "@/lib/hooks/use-vault-markdown-source";
import { makeWikilinkResolver, useWikilinkClick, type CiteLinkEntry } from "@/lib/hooks/use-cite-links";
import { hashTargetId } from "./vault-markdown-helpers";

/** Minimal title/id pair for wikilink resolution. */
export type WikilinkEntry = CiteLinkEntry;

/**
 * Expand `![[Note]]` transclusions to the target note's body, rendered as a
 * titled callout (wf-core `vault::page::expand_embeds`). The callback can't
 * cross into wasm, so each title is resolved here first.
 */
function expandBodyEmbeds(body: string, resolveEmbed: (title: string) => string | null): string {
  const resolved = new Map<string, string>();
  for (const title of readyCore().embedTitles(body)) {
    if (resolved.has(title)) continue;
    const inner = resolveEmbed(title);
    if (inner != null) resolved.set(title, inner);
  }
  return readyCore().expandEmbeds(body, resolved);
}

/**
 * Renders vault markdown with embedded images resolved via blob URLs.
 * Image syntax: `![alt](vault:userId/pageId/file.png)`.
 */
export function VaultMarkdown({
  body,
  className,
  notes = [],
  papers = [],
  sections = [],
  onCreateNote,
  resolveEmbed,
}: {
  body: string;
  className?: string;
  notes?: WikilinkEntry[];
  papers?: WikilinkEntry[];
  sections?: WikilinkEntry[];
  onCreateNote?: (title: string) => void;
  resolveEmbed?: (title: string) => string | null;
}) {
  const source = useMemo(
    () => (resolveEmbed ? expandBodyEmbeds(body, resolveEmbed) : body),
    [body, resolveEmbed],
  );

  const resolveWikilink = useMemo(
    () => makeWikilinkResolver(notes, papers, sections),
    [notes, papers, sections],
  );

  const onClick = useWikilinkClick(onCreateNote);

  const resolved = useVaultImageSource(source);

  // Scroll to `#heading` / `#^blockid` after render (Obsidian-style deep links).
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const id = hashTargetId(hash);
    const el = document.getElementById(id) ?? document.getElementById(`^${id.replace(/^\^/, "")}`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [resolved]);

  return (
    <div className="vault-markdown-scope" onClick={onClick}>
      <ShikiMarkdown className={className} resolveWikilink={resolveWikilink}>
        {resolved}
      </ShikiMarkdown>
    </div>
  );
}
