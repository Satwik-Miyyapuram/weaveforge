"use client";

import { useCallback, useMemo } from "react";
import { normalizeMarkdownImageSyntax } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ShikiMarkdown } from "@/components/markdown/shiki-markdown";
import { stripRegionMarkers } from "@/features/vault/application/note-template-engine";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";
import { useWikilinkNavigation } from "@/lib/hooks/use-cite-links";
import { PAPER_IMAGE_PREFIX, paperImagePathsInBody } from "../lib/paper-images-md";
import { fetchPaperImageBlob, fetchPaperImageBlobs } from "../lib/image-variants";
import { stripUnresolvedImageRefs } from "@/lib/markdown-image-refs";

const PAPER_IMAGES_BUCKET = "paper-images";

function stripUnresolved(body: string, paths: readonly string[], urls: Map<string, string>): string {
  const normalized = stripRegionMarkers(normalizeMarkdownImageSyntax(body));
  return stripUnresolvedImageRefs(normalized, PAPER_IMAGE_PREFIX, paths, urls);
}

/** Renders a paper note's markdown with inline images resolved to decrypted blob URLs. */
export function PaperMarkdown({ body, className }: { body: string; className?: string }) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const paths = useMemo(() => paperImagePathsInBody(body), [body]);
  const fetchOne = useCallback((path: string) => fetchPaperImageBlob(getContainer().papers, path), []);
  const fetchMany = useCallback(
    (ps: readonly string[]) => fetchPaperImageBlobs(getContainer().papers, ps),
    [],
  );
  const urls = useBlobObjectUrls(
    paths,
    useMemo(() => ({ cacheBucket: PAPER_IMAGES_BUCKET, fetchOne, fetchMany }), [fetchOne, fetchMany]),
  );

  const resolved = useMemo(() => {
    let next = stripUnresolved(body, paths, urls);
    for (const path of paths) {
      const url = urls.get(path);
      if (url) next = next.replaceAll(`${PAPER_IMAGE_PREFIX}${path}`, url);
    }
    return next;
  }, [body, paths, urls]);

  return (
    <div className="wikilink-markdown-scope" onClick={onWikilinkClick}>
      <ShikiMarkdown className={className} resolveWikilink={resolveWikilink}>
        {resolved}
      </ShikiMarkdown>
    </div>
  );
}
