"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeMarkdownImageSyntax, type Experiment } from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { ShikiMarkdown } from "@/components/shiki-markdown";
import { useDecryptedObjectUrls } from "@/lib/use-decrypted-asset";
import { useWikilinkNavigation } from "@/lib/use-cite-links";
import { REPORT_IMAGE_PREFIX, reportImagePathsInBody } from "../lib/report-images-md";
import {
  parseArtifactRefs,
} from "../application/artifact-refs";
import { resolveArtifactRefsMarkdown } from "../application/resolve-artifact-markdown";

const REPORT_IMAGES_BUCKET = "report-images";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripUnresolved(body: string, paths: readonly string[], urls: Map<string, string>): string {
  let next = normalizeMarkdownImageSyntax(body);
  for (const path of paths) {
    if (urls.has(path)) continue;
    const ref = `${REPORT_IMAGE_PREFIX}${path}`;
    next = next.replace(new RegExp(`!\\[[^\\]]*\\]\\(${escapeRegExp(ref)}\\)`, "g"), "");
  }
  return next;
}

/** Renders section notes markdown with `reportimg:` and `expartifact:` resolved. */
export function ReportSectionMarkdown({ body, className }: { body: string; className?: string }) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const hasArtifactRefs = useMemo(() => parseArtifactRefs(body).length > 0, [body]);
  useEffect(() => {
    if (!hasArtifactRefs) {
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
          setExperiments([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [hasArtifactRefs]);

  const withArtifacts = useMemo(() => {
    if (!hasArtifactRefs) return body;
    // Wait until load finishes — never flash false "missing experiment" warnings.
    if (experiments == null) return body;
    return resolveArtifactRefsMarkdown(body, experiments);
  }, [body, experiments, hasArtifactRefs]);

  const paths = useMemo(() => reportImagePathsInBody(withArtifacts), [withArtifacts]);
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
