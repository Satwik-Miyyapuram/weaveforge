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
  resolveArtifactRef,
  type ArtifactLookup,
} from "../application/artifact-refs";

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

/** Replace `expartifact:` refs with a resolved figure or a warning block (C4). */
function resolveArtifactRefs(body: string, experiments: readonly Experiment[]): string {
  const refs = parseArtifactRefs(body);
  if (refs.length === 0) return body;

  const byId = new Map(experiments.map((e) => [e.id, e]));
  const lookup: ArtifactLookup = { getExperiment: (id) => byId.get(id) ?? null };

  let out = "";
  let cursor = 0;
  for (const ref of refs) {
    out += body.slice(cursor, ref.start);
    cursor = ref.end;
    const resolution = resolveArtifactRef(ref, lookup);
    const caption = ref.alt || "artifact";
    switch (resolution.status) {
      case "resolved":
        out += `![${caption}](${resolution.artifactName})`;
        break;
      case "experiment_stale":
        out += `![${caption}](${resolution.artifactName})\n> ⚠️ Experiment is running but stale — this figure may be out of date.`;
        break;
      case "experiment_not_found":
        out += `> ⚠️ Missing experiment for artifact “${caption}”.`;
        break;
      case "artifact_not_found":
        out += `> ⚠️ Artifact “${caption}” was not found on experiment ${resolution.experiment.name}.`;
        break;
    }
  }
  out += body.slice(cursor);
  return out;
}

/** Renders section notes markdown with `reportimg:` and `expartifact:` resolved. */
export function ReportSectionMarkdown({ body, className }: { body: string; className?: string }) {
  const { resolveWikilink, onWikilinkClick } = useWikilinkNavigation();
  const [experiments, setExperiments] = useState<Experiment[]>([]);

  const hasArtifactRefs = useMemo(() => parseArtifactRefs(body).length > 0, [body]);
  useEffect(() => {
    if (!hasArtifactRefs) return;
    let cancelled = false;
    void getContainer()
      .experiments.loadExperiments()
      .then((list) => {
        if (!cancelled) setExperiments(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [hasArtifactRefs]);

  const withArtifacts = useMemo(
    () => (hasArtifactRefs ? resolveArtifactRefs(body, experiments) : body),
    [body, experiments, hasArtifactRefs],
  );

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
      <ShikiMarkdown className={className} resolveWikilink={resolveWikilink}>
        {resolved}
      </ShikiMarkdown>
    </div>
  );
}
