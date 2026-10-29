"use client";

import { useMemo } from "react";
import { normalizeMarkdownImageSyntax } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Markdown } from "@/components/markdown/markdown";
import { useBlobObjectUrls, type BlobFetchers } from "@/lib/hooks/use-blob-object-urls";
import { stripUnresolvedImageRefs } from "@/lib/markdown-image-refs";
import { LOG_IMAGE_PREFIX, logImagePathsInBody } from "../lib/log-images-md";

const FETCHERS: BlobFetchers = {
  cacheBucket: "log-images",
  fetchOne: async (path) => (await getContainer().logbook.fetchImageBlobs([path])).get(path) ?? null,
  fetchMany: (paths) => getContainer().logbook.fetchImageBlobs(paths),
};

/** A log entry's markdown with its `logimg:` pictures resolved to blob URLs (S-16). */
export function LogMarkdown({ children, className }: { children: string; className?: string }) {
  const paths = useMemo(() => logImagePathsInBody(children), [children]);
  const urls = useBlobObjectUrls(paths, FETCHERS);
  const resolved = useMemo(() => {
    if (paths.length === 0) return children;
    let next = stripUnresolvedImageRefs(normalizeMarkdownImageSyntax(children), LOG_IMAGE_PREFIX, paths, urls);
    for (const path of paths) {
      const url = urls.get(path);
      if (url) next = next.replaceAll(`${LOG_IMAGE_PREFIX}${path}`, url);
    }
    return next;
  }, [children, paths, urls]);
  return <Markdown className={className}>{resolved}</Markdown>;
}
