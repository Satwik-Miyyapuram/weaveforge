"use client";

import { useEffect, useState } from "react";
import { PopoverLayer } from "../reference-popover-layer";
import { ReferencePopover } from "../reference-popover";
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
  const { open, close, resolutions, actions, linked, notice, index } = refs;
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
              onClick={() => setChosen(e.index)}
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
        onReadLater={() => void actions.readLater(entry)}
        onAddToLibrary={() => void actions.addToLibrary(entry)}
        onOpenInReader={paper ? () => onOpenInReader(paper.id) : undefined}
        onLinkPapers={paper ? () => void actions.linkPapers(paper.id) : undefined}
        onCite={() => void actions.cite(resolution, entry)}
        onAddManually={() => void actions.addManually(entry)}
        onJumpToEntry={() => actions.jumpToEntry(entry)}
        alreadyLinked={paper ? linked.has(paper.id) : false}
        confidence={open.confidence}
      />
      {notice && <p role="status" className="pdf-reader-ref-skeleton">{notice}</p>}
    </PopoverLayer>
  );
}
