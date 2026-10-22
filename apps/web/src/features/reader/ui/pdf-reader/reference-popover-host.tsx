"use client";

import { useEffect, useState } from "react";
import { PopoverLayer } from "../reference-popover-layer";
import { ReferencePopover } from "../reference-popover";
import { noticeFor } from "../../application/reference-notice";
import type { useReaderReferences } from "./use-reader-references";

interface ReferencePopoverHostProps {
  refs: ReturnType<typeof useReaderReferences>;
  onOpenInReader: (paperId: string) => void;
}

/**
 * The one popover the reader shows: the mention that was clicked, its
 * resolution, and the actions, wired to the container-backed hook so the
 * presentational popover stays free of container access.
 */
export function ReferencePopoverHost({ refs, onOpenInReader }: ReferencePopoverHostProps) {
  const { open, close, ensureResolved, resolutions, actions, linked, notice, index } = refs;
  // A range like `[2–4]` is one printed mention citing several entries; the
  // popover shows one at a time and lets the reader switch between them.
  const [chosen, setChosen] = useState<number | null>(null);
  useEffect(() => { setChosen(null); }, [open?.hit.key]);
  if (!open) return null;
  const { hit, anchor } = open;
  const cited = hit.refIndexes.map((i) => index.byIndex.get(i)).filter((e): e is NonNullable<typeof e> => Boolean(e));
  const entry = (chosen != null && cited.find((e) => e.index === chosen)) || open.entry;
  const resolution = resolutions.get(entry.index) ?? { status: "pending" as const };
  const paper = resolution.status === "resolved" ? resolution.inLibrary : undefined;
  const metadata = resolution.status === "resolved" ? resolution.metadata : undefined;
  const status = noticeFor(notice, entry.index);
  return (
    <PopoverLayer anchorKey={hit.key} anchor={anchor} onRequestClose={close}>
      {cited.length > 1 && (
        <div className="pdf-reader-ref-actions pdf-reader-ref-cluster" role="tablist" aria-label="Cited entries">
          {cited.map((e) => (
            <button
              key={e.index}
              type="button"
              role="tab"
              aria-selected={e.index === entry.index}
              className={`pdf-reader-ref-action${e.index === entry.index ? " is-active" : ""}`}
              onClick={() => { setChosen(e.index); ensureResolved(e); }}
            >
              {e.label ?? `[${e.index}]`}
            </button>
          ))}
        </div>
      )}
      <ReferencePopover
        entry={entry}
        resolution={resolution}
        onClose={close}
        onAddToLibrary={() => void actions.addToLibrary(entry, metadata)}
        onOpenInReader={paper ? () => onOpenInReader(paper.id) : undefined}
        onLinkPapers={paper ? () => void actions.linkPapers(entry, paper.id) : undefined}
        onCite={() => void actions.cite(resolution, entry)}
        onAddManually={() => void actions.addManually(entry)}
        onJumpToEntry={() => actions.jumpToEntry(entry)}
        alreadyLinked={paper ? linked.has(paper.id) : false}
        confidence={open.confidence}
      />
      {status && <p role="status" className="pdf-reader-ref-skeleton">{status}</p>}
    </PopoverLayer>
  );
}
