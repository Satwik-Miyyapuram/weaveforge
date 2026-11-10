"use client";

import { useMemo } from "react";
import { getContainer } from "@/bootstrap";
import { Markdown } from "@/components/markdown/markdown";
import { useBlobObjectUrls, type BlobFetchers } from "@/lib/hooks/use-blob-object-urls";
import { readyCore } from "@/lib/rust-core";
import { LOG_IMAGE_PREFIX } from "../lib/log-image-ref";

const FETCHERS: BlobFetchers = {
  cacheBucket: "log-images",
  fetchOne: async (path) => (await getContainer().logbook.fetchImageBlobs([path])).get(path) ?? null,
  fetchMany: (paths) => getContainer().logbook.fetchImageBlobs(paths),
};

/** A log entry's markdown with its `logimg:` pictures resolved to blob URLs (S-16). */
export function LogMarkdown({ children, className }: { children: string; className?: string }) {
  const paths = useMemo(() => readyCore().imagePathsInBody(children, LOG_IMAGE_PREFIX), [children]);
  const urls = useBlobObjectUrls(paths, FETCHERS);
  const resolved = useMemo(() => {
    if (paths.length === 0) return children;
    let next = readyCore().stripUnresolvedImageRefs(readyCore().normalizeMarkdownImageSyntax(children), LOG_IMAGE_PREFIX, paths, [...urls.keys()]);
    for (const path of paths) {
      const url = urls.get(path);
      if (url) next = next.replaceAll(`${LOG_IMAGE_PREFIX}${path}`, url);
    }
    return next;
  }, [children, paths, urls]);
  return <Markdown className={className}>{resolved}</Markdown>;
}
