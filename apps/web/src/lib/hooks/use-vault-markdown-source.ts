"use client";

import { useMemo } from "react";
import { getContainer } from "@/bootstrap";
import { readyCore } from "@/lib/rust-core";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { useBlobObjectUrls } from "@/lib/hooks/use-blob-object-urls";

const VAULT_ASSETS_BUCKET = "vault-assets";

/** One note image: a failed fetch drops the image, and the log says which. */
export async function assetOrNull(fetch: (path: string) => Promise<Blob | null>, path: string): Promise<Blob | null> {
  try {
    return await fetch(path);
  } catch (err) {
    logToApp({
      level: "warn",
      source: "vault",
      message: "A note image could not load",
      detail: `${path}: ${formatError(err)}`,
    });
    return null;
  }
}

/**
 * Pure step: swap each `vault:` picture that has a blob URL for that URL, and
 * drop the ones still loading. Pass-through for markdown with no `vault:` refs
 * beyond the normalisation every note body already gets.
 */
export function resolveVaultImageSource(
  body: string,
  paths: readonly string[],
  urls: ReadonlyMap<string, string>,
): string {
  const normalized = readyCore().stripRegionMarkers(readyCore().normalizeMarkdownImageSyntax(body));
  let next = readyCore().stripUnresolvedImageRefs(normalized, readyCore().vaultImagePrefix(), paths, [...urls.keys()]);
  for (const path of paths) {
    const url = urls.get(path);
    if (!url) continue;
    next = next.replaceAll(`${readyCore().vaultImagePrefix()}${path}`, url);
  }
  return next;
}

/**
 * Markdown source with its `vault:` pictures resolved to blob URLs. Shared by
 * note pages and canvas text nodes, so both show the same pictures.
 */
export function useVaultImageSource(source: string): string {
  const paths = useMemo(() => readyCore().vaultAssetPathsInBody(source), [source]);

  const fetchers = useMemo(
    () => ({
      cacheBucket: VAULT_ASSETS_BUCKET,
      fetchOne: (path: string) => assetOrNull((p) => getContainer().vault.fetchAssetBlob(p), path),
      fetchMany: (ps: readonly string[]) => getContainer().vault.fetchAssetBlobs(ps),
    }),
    [],
  );

  const urls = useBlobObjectUrls(paths, fetchers);

  return useMemo(() => resolveVaultImageSource(source, paths, urls), [source, paths, urls]);
}
