"use client";

import { useEffect, useRef, useState } from "react";

export interface DecryptedBlobFetchers {
  fetchOne: (path: string) => Promise<Blob | null>;
  fetchMany?: (paths: readonly string[]) => Promise<Map<string, Blob>>;
  cacheBucket?: string;
}

/**
 * Fetch blobs and expose short-lived object URLs for markdown/image preview.
 * (Name is legacy — storage is plaintext via PassthroughBlobStore; no client decrypt.)
 * Revokes URLs on unmount or when paths change.
 */
export function useDecryptedObjectUrls(
  paths: readonly string[],
  fetchers: DecryptedBlobFetchers | ((path: string) => Promise<Blob | null>),
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  // `key` is the identity that matters: the effect depends on the *contents* of
  // `paths`, never on the array's identity. Callers routinely build the array
  // inline (`.slice()`, `.filter()`), so depending on the array itself made the
  // effect re-run on every render — and since it calls setUrls, that is an
  // unbounded fetch loop. The live array is read through a ref instead.
  const key = paths.join("|");
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const fetchOne =
    typeof fetchers === "function" ? fetchers : fetchers.fetchOne;
  const fetchMany = typeof fetchers === "function" ? undefined : fetchers.fetchMany;
  const cacheBucket =
    typeof fetchers === "function" ? undefined : fetchers.cacheBucket;

  useEffect(() => {
    let cancelled = false;
    const objectUrls: string[] = [];

    const paths = pathsRef.current;

    void (async () => {
      if (paths.length === 0) {
        setUrls((prev) => (prev.size === 0 ? prev : new Map()));
        return;
      }

      let blobs: Map<string, Blob>;
      if (fetchMany && paths.length > 1) {
        blobs = await fetchMany(paths);
      } else if (cacheBucket) {
        const { fetchDecryptedManyCached } = await import("@/lib/blob-fetch-cache");
        blobs = await fetchDecryptedManyCached(
          cacheBucket,
          paths,
          async (path) => {
            const blob = await fetchOne(path);
            if (!blob) throw new Error("missing blob");
            return blob;
          },
          fetchMany ? (ps) => fetchMany(ps) : undefined,
        );
      } else {
        blobs = new Map<string, Blob>();
        await Promise.all(
          paths.map(async (path) => {
            try {
              const blob = await fetchOne(path);
              if (blob) blobs.set(path, blob);
            } catch {
              // skip broken assets
            }
          }),
        );
      }

      const map = new Map<string, string>();
      for (const [path, blob] of blobs) {
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        map.set(path, url);
      }
      if (!cancelled) setUrls(map);
    })();

    return () => {
      cancelled = true;
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [key, fetchOne, fetchMany, cacheBucket]);

  return urls;
}
