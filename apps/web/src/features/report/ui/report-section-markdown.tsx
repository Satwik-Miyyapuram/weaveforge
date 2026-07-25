"use client";

import { useCallback, useMemo } from "react";
import { normalizeMarkdownImageSyntax } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ShikiMarkdown } from "@/components/shiki-markdown";
import { useDecryptedObjectUrls } from "@/lib/use-decrypted-asset";
import { useWikilinkNavigation } from "@/lib/use-cite-links";
import { REPORT_IMAGE_PREFIX, reportImagePathsInBody } from "../lib/report-images-md";

const REPORT_IMAGES_BUCKET = "report-images";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Drop unresolved images so raw `![](reportimg:…)` never leaks into prose HTML. */
function stripUnresolved(body: string, paths: readonly string[], urls: Map<string, string>): string {
  let next = normalizeMarkdownImageSyntax(body);
  for (const path of paths) {
    if (urls.has(path)) continue;
    const ref = `${REPORT_IMAGE_PREFIX}${path}`;
    next = next.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(ref)}\\)`, "g"), "");
  }
  return next;
}

/** Renders section notes markdown with `reportimg:` resolved to blob URLs. */
export function ReportSectionMarkdown({ body, className }: { body: string; className?: string }) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const paths = useMemo(() => reportImagePathsInBody(body), [body]);
  const fetchOne = useCallback(
    (path: string) => getContainer().report.fetchImageBlob(path).catch(() => null),
    [],
  );
  const fetchMany = useCallback(
    (ps: readonly string[]) => getContainer().report.fetchImageBlobs(ps),
    [],
  );
  const urls = useDecryptedObjectUrls(
    paths,
    useMemo(() => ({ cacheBucket: REPORT_IMAGES_BUCKET, fetchOne, fetchMany }), [fetchOne, fetchMany]),
  );

  const resolved = useMemo(() => {
    let next = stripUnresolved(body, paths, urls);
    for (const path of paths) {
      const url = urls.get(path);
      if (url) next = next.replaceAll(`${REPORT_IMAGE_PREFIX}${path}`, url);
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
