"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeMarkdownImageSyntax, type Experiment } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ShikiMarkdown } from "@/components/markdown/shiki-markdown";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";
import { useWikilinkNavigation } from "@/lib/hooks/use-cite-links";
import { REPORT_IMAGE_PREFIX, reportImagePathsInBody } from "../lib/report-images-md";
import {
  parseArtifactRefs,
} from "../application/artifact-refs";
import { resolveArtifactRefsMarkdown } from "../application/resolve-artifact-markdown";
import { stripUnresolvedImageRefs } from "@/lib/markdown-image-refs";

const REPORT_IMAGES_BUCKET = "report-images";

function stripUnresolved(body: string, paths: readonly string[], urls: Map<string, string>): string {
  return stripUnresolvedImageRefs(normalizeMarkdownImageSyntax(body), REPORT_IMAGE_PREFIX, paths, urls);
}

/** Renders section notes markdown with `reportimg:` and `expartifact:` resolved. */
export function ReportSectionMarkdown({
  body,
  className,
  /** Shared/guest sections cannot load the owner's experiments — skip resolve. */
  skipArtifactResolve = false,
}: {
  body: string;
  className?: string;
  skipArtifactResolve?: boolean;
}) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasArtifactRefs = useMemo(() => parseArtifactRefs(body).length > 0, [body]);
  useEffect(() => {
    if (!hasArtifactRefs || skipArtifactResolve) {
      setExperiments(null);
      setLoadError(null);
      return;
    }
    let cancelled = false;
    setExperiments(null);
    setLoadError(null);
    void getContainer()
      .experiments.loadExperiments()
      .then((list) => {
        if (!cancelled) setExperiments(list);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Could not load experiments.");
          // Empty list so resolve emits missing-artifact warnings instead of raw refs.
          setExperiments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasArtifactRefs, skipArtifactResolve]);

  const withArtifacts = useMemo(() => {
    if (!hasArtifactRefs) return body;
    if (skipArtifactResolve) {
      return body.replace(
        /!?\[[^\]]*\]\(expartifact:[^)]+\)/gi,
        "> ⚠️ Experiment artifacts are unavailable in shared view.",
      );
    }
    // Wait until load finishes — never flash false "missing experiment" warnings.
    if (experiments == null) return body;
    return resolveArtifactRefsMarkdown(body, experiments);
  }, [body, experiments, hasArtifactRefs, skipArtifactResolve]);

  const paths = useMemo(() => reportImagePathsInBody(withArtifacts), [withArtifacts]);
  const fetchOne = useCallback(
    (path: string) => getContainer().report.fetchImageBlob(path).catch(() => null),
    [],
  );
  const fetchMany = useCallback(
    (ps: readonly string[]) => getContainer().report.fetchImageBlobs(ps),
    [],
  );
  const urls = useBlobObjectUrls(
    paths,
    useMemo(() => ({ cacheBucket: REPORT_IMAGES_BUCKET, fetchOne, fetchMany }), [fetchOne, fetchMany]),
  );

  const resolved = useMemo(() => {
    let next = stripUnresolved(withArtifacts, paths, urls);
    for (const path of paths) {
      const url = urls.get(path);
      if (url) next = next.replaceAll(`${REPORT_IMAGE_PREFIX}${path}`, url);
    }
    return next;
  }, [withArtifacts, paths, urls]);

  return (
    <div className="wikilink-markdown-scope" onClick={onWikilinkClick}>
      {loadError && (
        <p className="error" role="alert">
          Experiment artifacts unavailable: {loadError}
        </p>
      )}
      <ShikiMarkdown className={className} resolveWikilink={resolveWikilink}>
        {resolved}
      </ShikiMarkdown>
    </div>
  );
}
