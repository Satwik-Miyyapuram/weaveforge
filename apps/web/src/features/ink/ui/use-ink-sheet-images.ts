"use client";

/**
 * The images an ink sheet's text layer references, as blob URLs.
 *
 * The sheet's underlay renders markdown in one synchronous pass
 * (`renderMarkdownPlain`), so an image reference has to be a URL the browser
 * can fetch *by then*. Two prefixes reach this layer and each has its own
 * store: `vault:` is the vault's attachments — which is also where a note's
 * own figure lines live — and `paperimg:` is a paper's figures, which are
 * encrypted blobs behind the papers facade. The underlay knew about neither,
 * so every image on a paper's Notes tab came out as its own markdown source
 * while Read mode showed it, and `pureInkPageText` did not even recognise a
 * `paperimg:` figure line as a figure.
 *
 * The fetch is async and the render is not, so this hook is the seam: it
 * fetches everything the text mentions and hands back the map. A path the map
 * has no URL for is one that cannot be shown, and the underlay drops it rather
 * than painting a broken image.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { VAULT_IMAGE_PREFIX } from "@weaveforge/core";

import { getContainer } from "@/bootstrap";
import { PAPER_IMAGE_PREFIX, paperImagePathsInBody } from "@/features/papers/lib/paper-images-md";
import { paperImageThumbnailPath } from "@/features/papers/lib/image-variants";
import { useInkFigureUrls } from "./use-ink-figure-urls";
import type { InkHostDeps } from "./ink-host-types";

/** Every `vault:` path the text references. Kept local: core owns the writer. */
function vaultImagePaths(text: string): string[] {
  const found = new Set<string>();
  const re = /!\[[^\]]*\]\(vault:([^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) found.add(match[1]!);
  return [...found];
}

/** `vault:<path>` from a src the renderer captured, or null for another prefix. */
function vaultPathOf(src: string): string | null {
  return src.startsWith(VAULT_IMAGE_PREFIX) ? src.slice(VAULT_IMAGE_PREFIX.length) : null;
}

/**
 * The bytes behind one ink-sheet image reference.
 *
 * The path may carry a scheme or be bare. Bare is what a placed figure's path
 * has always been (the vault's attachments), and it is also what an inline
 * `vault:` reference reduces to here; `paperimg:` is a paper's figure, and
 * without the paper it belongs to there is nothing it could resolve to.
 */
export async function inkSheetImageFetchBlob(
  path: string,
  deps: InkHostDeps,
  paperId: string | null,
): Promise<Blob> {
  const paperPath = paperPathOf(path);
  if (paperPath !== null) {
    if (!paperId) throw new Error("a paper image needs the paper it belongs to");
    const papers = getContainer().papers;
    const blob =
      (await papers.fetchImageBlob(paperImageThumbnailPath(paperPath)).catch(() => null)) ??
      (await papers.fetchImageBlob(paperPath).catch(() => null));
    if (!blob) throw new Error(`missing paper image: ${paperPath}`);
    return blob;
  }
  return deps.assets.fetchBlob(vaultPathOf(path) ?? path);
}

/** `paperimg:<path>` from a src the renderer captured, or null for another prefix. */
function paperPathOf(src: string): string | null {
  return src.startsWith(PAPER_IMAGE_PREFIX) ? src.slice(PAPER_IMAGE_PREFIX.length) : null;
}

/**
 * Every page's text as one body, memoised on its contents.
 *
 * The host holds the pages in a ref that a stroke mutates, and the array's
 * identity is new on every render, so the memo is keyed by passed-in text
 * rather than by the array. Kept here so the host stays wiring.
 */
function useSheetText(pages: { current: readonly string[] }, key: string): string {
  const ref = useRef(pages);
  ref.current = pages;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => ref.current.current.join("\n"), [key]);
}

/**
 * Every image a live sheet paints, from the one place that knows both stores.
 *
 * The host calls this with its page-text ref and its placed figures; `key` is
 * the pages' own text, so a stroke that changes nothing about the images does
 * not re-fetch them. What comes back is the whole image wiring the host needs:
 * `figureUrls` for the figures painted on the page, and `resolveImageSrc` for
 * the inline images the underlay's markdown pass renders.
 */
export function useInkSheetImages(input: {
  /** The figures placed on the page being looked at. */
  figures: readonly { path: string }[];
  /** The note's per-page text, in a ref the host mutates as it is drawn on. */
  pages: { current: readonly string[] };
  /** The pages' own text, as the memo key. */
  key: string;
  deps: InkHostDeps;
  paperId: string | null;
}): { figureUrls: ReadonlyMap<string, string>; resolveImageSrc: (src: string) => string | null } {
  const { figures, pages, key, deps, paperId } = input;
  const images = useInkSheetImageUrls(useSheetText(pages, key), paperId);
  // A placed figure carries a bare path (core strips the scheme), and a figure
  // is only ever a note's own attachment.
  const fetchBlob = useCallback((path: string) => deps.assets.fetchBlob(path), [deps.assets]);
  const figureUrls = useInkFigureUrls({ fetchBlob, figures });
  // `useInkSheetImageUrls` already hands back a stable identity that only
  // changes when its answers do, which is exactly what the underlay's markdown
  // memo needs: a new function is a new pass, and a pass is how a URL that has
  // just landed reaches the DOM.
  return useMemo(
    () => ({ figureUrls, resolveImageSrc: images.resolveImageSrc }),
    [figureUrls, images.resolveImageSrc],
  );
}

export interface InkSheetImageUrls {
  /** `src` as the renderer captured it → a fetchable URL, or null to drop it. */
  resolveImageSrc: (src: string) => string | null;
}

/**
 * Resolve every image an ink sheet references to a blob URL.
 *
 * `text` is the whole note body, not one page: the paths are the same on every
 * page of it, and resolving per page would fetch the same figure five times.
 *
 * `paperId` is the paper whose Notes tab this sheet is, when it is one: a
 * `paperimg:` path is meaningless without it, and a note that is not a paper's
 * simply never has one.
 */
/** The object URLs a set of paths resolved to, fetched once each. */
function useObjectUrls(
  paths: readonly string[],
  fetchOne: (path: string) => Promise<Blob | null>,
  fetchMany: (paths: readonly string[]) => Promise<Map<string, Blob>> | undefined,
): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  // The paths' own contents are the identity that matters: callers build the
  // array inline, so depending on the array re-runs the effect on every render,
  // and depending on nothing at all never fetches.
  const key = paths.join("|");
  const pathsRef = useRef(paths);
  pathsRef.current = paths;
  const fetchOneRef = useRef(fetchOne);
  fetchOneRef.current = fetchOne;
  const fetchManyRef = useRef(fetchMany);
  fetchManyRef.current = fetchMany;

  useEffect(() => {
    if (key === "") {
      setUrls((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    let live = true;
    const made: string[] = [];
    void (async () => {
      const wanted = pathsRef.current;
      const blobs = new Map<string, Blob>();
      const batch = fetchManyRef.current;
      if (batch && wanted.length > 1) {
        const batchBlobs = await batch(wanted);
        if (batchBlobs) {
          for (const [path, blob] of batchBlobs) blobs.set(path, blob);
        }
      }
      for (const path of wanted) {
        if (blobs.has(path)) continue;
        try {
          const blob = await fetchOneRef.current(path);
          if (blob) blobs.set(path, blob);
        } catch {
          // A missing asset is an image that never appears, not a broken page.
        }
      }
      if (!live) return;
      const next = new Map<string, string>();
      for (const [path, blob] of blobs) {
        const url = URL.createObjectURL(blob);
        made.push(url);
        next.set(path, url);
      }
      setUrls(next);
    })();
    return () => {
      live = false;
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [key]);

  return urls;
}

export function useInkSheetImageUrls(text: string, paperId: string | null): InkSheetImageUrls {
  const vaultPaths = useMemo(() => vaultImagePaths(text), [text]);
  const paperPaths = useMemo(() => paperImagePathsInBody(text), [text]);

  const vaultUrls = useObjectUrls(
    vaultPaths,
    useCallback(
      (path: string) => getContainer().vault.fetchAssetBlob(path).catch(() => null),
      [],
    ),
    useCallback(
      (paths: readonly string[]) => getContainer().vault.fetchAssetBlobs(paths),
      [],
    ),
  );

  // A paper's own figure bytes: the thumbnail variant first (the sheet draws it
  // at page size, so the thumbnail is the right bytes), the full image as the
  // fallback for figures that have no variant yet.
  const fetchPaperBlob = useCallback(async (path: string): Promise<Blob | null> => {
    const papers = getContainer().papers;
    const thumbnail = await papers.fetchImageBlob(paperImageThumbnailPath(path)).catch(() => null);
    if (thumbnail) return thumbnail;
    return papers.fetchImageBlob(path).catch(() => null);
  }, []);
  const fetchPaperBlobs = useCallback(async (paths: readonly string[]) => {
    const papers = getContainer().papers;
    const thumbnailPaths = paths.map(paperImageThumbnailPath);
    const thumbnails = await papers.fetchImageBlobs(thumbnailPaths);
    const missing = paths.filter((path) => !thumbnails.has(paperImageThumbnailPath(path)));
    const fulls = missing.length ? await papers.fetchImageBlobs(missing) : new Map<string, Blob>();
    const out = new Map<string, Blob>();
    for (const path of paths) {
      const thumbnail = thumbnails.get(paperImageThumbnailPath(path));
      const full = fulls.get(path);
      if (thumbnail) out.set(path, thumbnail);
      else if (full) out.set(path, full);
    }
    return out;
  }, []);

  // Without a paper there is nothing a `paperimg:` path could name, so the
  // fetch is not even attempted — and the map stays empty, which drops the
  // reference rather than leaving a broken one.
  const paperUrls = useObjectUrls(paperId ? paperPaths : [], fetchPaperBlob, fetchPaperBlobs);

  return useMemo(
    () => ({
      resolveImageSrc: (src: string) => {
        const vaultPath = vaultPathOf(src);
        if (vaultPath !== null) return vaultUrls.get(vaultPath) ?? null;
        const paperPath = paperPathOf(src);
        // `paperimg:` is never a URL the browser can fetch, so it must never be
        // handed to the renderer as one: an unresolved paper figure is dropped
        // (returns null), and the next pass puts it back once its blob lands.
        // Falling through to `src` here painted a broken icon on the sheet.
        if (paperPath !== null) return paperUrls.get(paperPath) ?? null;
        return src;
      },
    }),
    [vaultUrls, paperUrls],
  );
}

/**
 * Freeze a resolver's identity while letting its answer change.
 *
 * For a surface that must not re-render its body when a blob lands — the read
 * view's page list is keyed by page, and rewriting it would drop a mermaid
 * upgrade in flight. The identity stays put, so only a later pass sees the URL
 * the earlier one could not.
 */
export function useStableResolver(
  resolver: (src: string) => string | null,
): (src: string) => string | null {
  const ref = useRef(resolver);
  ref.current = resolver;
  return useMemo(() => (src: string) => ref.current(src), []);
}
