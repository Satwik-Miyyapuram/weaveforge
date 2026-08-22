"use client";

import { useEffect, useMemo } from "react";
import { normalizeMarkdownImageSyntax, VAULT_IMAGE_PREFIX, vaultAssetPathsInBody } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ShikiMarkdown } from "@/components/markdown/shiki-markdown";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";
import { makeWikilinkResolver, useWikilinkClick, type CiteLinkEntry } from "@/lib/hooks/use-cite-links";
import { stripRegionMarkers } from "../application/note-template-engine";

/** Minimal title/id pair for wikilink resolution. */
export type WikilinkEntry = CiteLinkEntry;

/**
 * Expand `![[Note]]` transclusions to the target note's body, rendered as a
 * titled callout. One level deep: nested embeds inside the target are dropped
 * so a cycle can't blow the render up.
 */
function expandEmbeds(body: string, resolveEmbed: (title: string) => string | null): string {
  return body.replace(/!\[\[([^\]\n|#]+)(?:[#|][^\]\n]*)?\]\]/g, (match, rawTitle: string) => {
    const title = rawTitle.trim();
    const inner = resolveEmbed(title);
    if (inner == null) return match;
    const oneLevel = inner.replace(/!\[\[[^\]\n]*\]\]/g, "").trim();
    const quoted = oneLevel
      ? oneLevel.split("\n").map((line) => `> ${line}`).join("\n")
      : "> _(empty note)_";
    return `\n\n> [!note] ${title}\n${quoted}\n\n`;
  });
}

const VAULT_ASSETS_BUCKET = "vault-assets";

function stripUnresolvedVaultImages(body: string, paths: readonly string[], urls: Map<string, string>): string {
  let next = stripRegionMarkers(normalizeMarkdownImageSyntax(body));
  for (const path of paths) {
    if (urls.has(path)) continue;
    const ref = `${VAULT_IMAGE_PREFIX}${path}`;
    next = next.replace(new RegExp(`!\\[[^\\]]*\\]\\(${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`, "g"), "");
  }
  return next;
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
    () => (resolveEmbed ? expandEmbeds(body, resolveEmbed) : body),
    [body, resolveEmbed],
  );

  const resolveWikilink = useMemo(
    () => makeWikilinkResolver(notes, papers, sections),
    [notes, papers, sections],
  );

  const onClick = useWikilinkClick(onCreateNote);

  const paths = useMemo(() => vaultAssetPathsInBody(source), [source]);

  const fetchers = useMemo(
    () => ({
      cacheBucket: VAULT_ASSETS_BUCKET,
      fetchOne: (path: string) =>
        getContainer()
          .vault.fetchAssetBlob(path)
          .catch(() => null),
      fetchMany: (ps: readonly string[]) => getContainer().vault.fetchAssetBlobs(ps),
    }),
    [],
  );

  const urls = useBlobObjectUrls(paths, fetchers);

  const resolved = useMemo(() => {
    let next = stripUnresolvedVaultImages(source, paths, urls);
    for (const path of paths) {
      const url = urls.get(path);
      if (!url) continue;
      next = next.replaceAll(`${VAULT_IMAGE_PREFIX}${path}`, url);
    }
    return next;
  }, [source, paths, urls]);

  // Scroll to `#heading` / `#^blockid` after render (Obsidian-style deep links).
  useEffect(() => {
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";
    if (!hash) return;
    const id = decodeURIComponent(hash);
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
