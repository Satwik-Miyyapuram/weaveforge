"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { EntityCard } from "@/components/entity-card";
import { readStored, writeStored } from "@/lib/safe-storage";
import { fetchWorkshopPdf, type WorkshopPdfDeps } from "@/features/overleaf/infrastructure/workshop-pdf-client";
import {
  loadOverleafThumb,
  readOverleafThumb,
  saveOverleafThumb,
  serialQueue,
  type OverleafThumbDeps,
  type ThumbStore,
} from "../lib/parts";
import type { OverleafProjectRow } from "../lib/parts";

type AuthHeaders = WorkshopPdfDeps["authHeaders"];
type Thumb = { kind: "loading" } | { kind: "image"; url: string } | { kind: "none" };

const store: ThumbStore = { get: (key) => readStored(key), set: (key, value) => writeStored(key, value) };
/** One compile at a time across every card on the page. */
const queue = serialQueue();

async function renderFirstPage(pdf: Blob): Promise<string> {
  const { renderPdfPage, toWebpBlob } = await import("@/features/ink/application/pdf-page-raster");
  const canvas = await renderPdfPage(await pdf.arrayBuffer(), 1, 360);
  const { blob } = await toWebpBlob(canvas);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function thumbDeps(authHeaders: AuthHeaders): OverleafThumbDeps {
  return {
    store,
    fetchPdf: async (sessionId, projectId) => {
      let pdf: Blob | null = null;
      const result = await fetchWorkshopPdf(
        { fetch: (url, init) => fetch(url, init), authHeaders, createObjectUrl: (blob) => { pdf = blob; return ""; } },
        sessionId,
        projectId,
        null,
      );
      return result.ok ? pdf : null;
    },
    render: renderFirstPage,
  };
}

/** Called by the PDF tab with the PDF it just showed, so the card shows the latest page. */
export function rememberOverleafThumb(projectId: string, pdf: Blob): void {
  void renderFirstPage(pdf).then((url) => saveOverleafThumb(store, projectId, url), () => undefined);
}

/** True once the element has come near the screen; stays true. */
function useSeen(ref: RefObject<HTMLElement | null>): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === "undefined") {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

function useOverleafThumb(projectId: string, sessionId: string | null, authHeaders: AuthHeaders, seen: boolean): Thumb {
  const [thumb, setThumb] = useState<Thumb>(() => {
    const kept = readOverleafThumb(store, projectId);
    return kept ? { kind: "image", url: kept } : { kind: sessionId ? "loading" : "none" };
  });
  useEffect(() => {
    if (!seen) return;
    let cancelled = false;
    // A card gone before its turn skips the compile.
    void queue(() => (cancelled ? Promise.resolve(null) : loadOverleafThumb(thumbDeps(authHeaders), sessionId, projectId))).then(
      (url) => { if (!cancelled) setThumb(url ? { kind: "image", url } : { kind: "none" }); },
    );
    return () => { cancelled = true; };
  }, [seen, projectId, sessionId, authHeaders]);
  return thumb;
}

/** An Overleaf project as a card: the first page of its PDF, then its name. */
export function OverleafProjectCard({
  row,
  meta,
  sessionId,
  authHeaders,
  onOpen,
}: {
  row: OverleafProjectRow;
  meta: string;
  sessionId: string | null;
  authHeaders: AuthHeaders;
  onOpen: () => void;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const thumb = useOverleafThumb(row.id, sessionId, authHeaders, useSeen(pageRef));
  return (
    <EntityCard
      as="li"
      className="overleaf-card"
      onActivate={onOpen}
      title={
        <>
          {row.report && <span className="overleaf-star" title="Linked to this WeaveForge project">★ </span>}
          {row.name}
        </>
      }
      meta={meta}
    >
      <div ref={pageRef} className="overleaf-card__page" aria-hidden>
        {thumb.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb.url} alt="" />
        ) : (
          <span className={thumb.kind === "loading" ? "overleaf-card__empty is-loading" : "overleaf-card__empty"}>
            {thumb.kind === "loading" ? "" : "No PDF yet"}
          </span>
        )}
      </div>
    </EntityCard>
  );
}
