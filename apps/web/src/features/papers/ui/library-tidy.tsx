"use client";

import { useEffect, useMemo, useState } from "react";
import {
  findDuplicateGroups,
  titleFixes,
  type DuplicateGroup,
  type PaperSummary,
  type TitleFix,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Modal } from "@/components/modal";
import { FormError } from "@/components/form-error";

/** What the tidy-up would offer for these papers. Pure, so the screen can count it cheaply. */
export function useLibraryTidy(papers: readonly PaperSummary[]) {
  return useMemo(
    () => ({ titles: titleFixes(papers), duplicates: findDuplicateGroups([...papers]) }),
    [papers],
  );
}

const REASON: Record<DuplicateGroup["reason"], string> = {
  doi: "Same DOI",
  arxiv: "Same arXiv id",
  title: "Same title",
};

/**
 * The notice on the Papers screen when older imports left placeholder titles
 * or second copies, and the dialog that fixes them. Shown only when there is
 * something to fix; nothing changes until the reader applies a fix.
 */
export function LibraryTidyNotice({
  papers,
  onChanged,
}: {
  papers: readonly PaperSummary[];
  onChanged: () => void | Promise<void>;
}) {
  const { titles, duplicates } = useLibraryTidy(papers);
  const [open, setOpen] = useState(false);
  if (titles.length === 0 && duplicates.length === 0) return null;

  const parts = [
    titles.length ? `${titles.length} title${titles.length === 1 ? "" : "s"} to fix` : null,
    duplicates.length ? `${duplicates.length} possible duplicate${duplicates.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <>
      <span className="tidy-notice" role="status">
        <span>{parts.join(" · ")}</span>
        <button type="button" className="tidy-notice-btn" onClick={() => setOpen(true)}>
          Review
        </button>
      </span>
      {open && (
        <Modal title="Tidy the library" onClose={() => setOpen(false)}>
          <LibraryTidyPanel papers={papers} titles={titles} duplicates={duplicates} onChanged={onChanged} />
        </Modal>
      )}
    </>
  );
}

function LibraryTidyPanel({
  papers,
  titles,
  duplicates,
  onChanged,
}: {
  papers: readonly PaperSummary[];
  titles: TitleFix[];
  duplicates: DuplicateGroup[];
  onChanged: () => void | Promise<void>;
}) {
  const byId = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  return (
    <div className="tidy-panel">
      {titles.length > 0 && (
        <section>
          <h3 className="tidy-head">Titles that name nothing</h3>
          <p className="muted tidy-lede">
            These were stored with a file name or a page label as the title. Check each proposal
            before applying it.
          </p>
          <ul className="tidy-list">
            {titles.map((fix) => (
              <TitleFixRow key={fix.id} fix={fix} onApplied={onChanged} />
            ))}
          </ul>
        </section>
      )}
      {duplicates.length > 0 && (
        <section>
          <h3 className="tidy-head">Possible duplicates</h3>
          <p className="muted tidy-lede">
            Merging keeps the chosen copy and moves the other&rsquo;s annotations, lists, fields,
            relations, tags and details into it. Notes link by title and are not touched.
          </p>
          <ul className="tidy-list">
            {duplicates.map((group) => (
              <DuplicateRow key={group.ids.join(",")} group={group} byId={byId} onMerged={onChanged} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function TitleFixRow({
  fix,
  onApplied,
}: {
  fix: TitleFix;
  onApplied: () => void | Promise<void>;
}) {
  const [value, setValue] = useState(fix.proposed ?? "");
  const [looking, setLooking] = useState(!!fix.lookup);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fix.lookup) return;
    let live = true;
    void getContainer()
      .libraryTidy.lookUpTitle(fix.lookup)
      .then((title) => {
        if (live && title) setValue((v) => v || title);
      })
      .finally(() => live && setLooking(false));
    return () => {
      live = false;
    };
  }, [fix.lookup]);

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      await getContainer().libraryTidy.setTitle(fix.id, value);
      setDone(true);
      await onApplied();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="tidy-row">
      <div className="tidy-current" title={fix.current}>
        <s>{fix.current || "(no title)"}</s>
      </div>
      <div className="tidy-fix">
        <input
          className="tidy-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={looking ? "Looking up…" : "Type the paper's title"}
          aria-label={`New title for ${fix.current || "untitled paper"}`}
          disabled={done}
        />
        <button type="button" className="btn-secondary" disabled={busy || done || !value.trim()} onClick={() => void apply()}>
          {done ? "Applied" : busy ? "Saving…" : "Apply"}
        </button>
      </div>
      {error && <FormError>{error}</FormError>}
    </li>
  );
}

function describe(p: PaperSummary | undefined): string {
  if (!p) return "";
  return [p.year, p.pdfPath ? "PDF" : null, p.status.replace("_", " "), p.doi ? `doi:${p.doi}` : null]
    .filter(Boolean)
    .join(" · ");
}

function DuplicateRow({
  group,
  byId,
  onMerged,
}: {
  group: DuplicateGroup;
  byId: Map<string, PaperSummary>;
  onMerged: () => void | Promise<void>;
}) {
  const [keepId, setKeepId] = useState(group.keepId);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Asked in the row rather than through `window.confirm`: a native dialog is
  // one the desktop shell may not show at all, and then the merge silently
  // never started. The answer also sits next to the choice it confirms.
  const [confirming, setConfirming] = useState(false);
  // Beside the row, not at the top of the dialog: with a long list the only
  // sign a merge failed was scrolled out of view, and the row looked untouched.
  const [error, setError] = useState<string | null>(null);
  const name = `keep-${group.ids.join("-")}`;
  const others = group.ids.length - 1;

  async function merge() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      await getContainer().libraryTidy.merge(keepId, group.ids);
      setDone(true);
      await onMerged();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="tidy-row">
      <fieldset className="tidy-group" disabled={busy || done}>
        <legend className="muted">{REASON[group.reason]} — keep:</legend>
        {group.ids.map((id) => {
          const p = byId.get(id);
          return (
            <label key={id} className="tidy-choice">
              <input type="radio" name={name} checked={keepId === id} onChange={() => setKeepId(id)} />
              <span>
                <span className="tidy-choice-title">{p?.title ?? id}</span>
                <span className="muted tidy-choice-meta">{describe(p)}</span>
              </span>
            </label>
          );
        })}
      </fieldset>
      {error && <FormError>{error}</FormError>}
      <div className="tidy-actions">
        {confirming ? (
          <>
            <span className="muted tidy-confirm">
              The other cop{others === 1 ? "y is" : "ies are"} deleted once {others === 1 ? "its" : "their"} contents move across.
            </span>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className="btn-primary btn-danger btn-sm" onClick={() => void merge()}>
              Merge
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || done}
            onClick={() => setConfirming(true)}
          >
            {done ? "Merged" : busy ? "Merging…" : "Merge…"}
          </button>
        )}
      </div>
    </li>
  );
}
