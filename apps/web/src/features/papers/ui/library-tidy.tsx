"use client";

import { enumLabel } from "@/lib/enum-label";
import { useEffect, useMemo, useState } from "react";
import {
  findDuplicateGroups,
  titleFixes,
  type DuplicateGroup,
  type PaperSummary,
  type TitleFix,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import type { LibraryTidyScan, TidyDuplicateGroup } from "@/container/facades/library-tidy";
import { formatError } from "@/lib/format-error";
import { Modal } from "@/components/modal";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";
import { useHiddenKeys } from "@/lib/toast";
import { mergeLater } from "./merge-later";
import { paperKey } from "./remove-paper";

/** What the tidy-up would offer for these papers. Pure, so the screen can count it cheaply. */
function useLibraryTidy(papers: readonly PaperSummary[]) {
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
      <div className="tidy-notice" role="status">
        <div className="tidy-notice-text">
          <strong>{parts.join(" · ")}</strong>
          <span className="muted">
            {duplicates.length
              ? "Merge duplicates so highlights, notes and list memberships live in one place."
              : "Some imports kept a file name or page label as the title."}
          </span>
        </div>
        <Button onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>
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
  const localById = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  // The groups above come from the card projection. The scan reads the grouped
  // papers in full, so the recommended copy also weighs venue, abstract and
  // rating, and a published copy can be offered. Until it answers (or if it
  // fails) the local recommendation stands.
  const [scan, setScan] = useState<Pick<LibraryTidyScan, "duplicates" | "papers"> | null>(null);
  useEffect(() => {
    if (duplicates.length === 0) return;
    let live = true;
    getContainer()
      .libraryTidy.scan()
      .then((result) => {
        if (live) setScan(result);
      })
      .catch(() => {
        /* keep the local recommendation */
      });
    return () => {
      live = false;
    };
  }, [duplicates]);
  const byId = scan?.papers ?? localById;
  const hiddenKeys = useHiddenKeys();
  // The scan is a snapshot: after a merge the papers reload but the scan does
  // not (and is not rerun once no duplicates remain), so a merged group would
  // stay on screen reading "Merged". Only offer groups whose copies all still exist.
  // A group being merged (its Undo toast still up) is hidden too.
  const groups: TidyDuplicateGroup[] = (scan?.duplicates ?? duplicates).filter((g) =>
    g.ids.every((id) => localById.has(id) && !hiddenKeys.has(paperKey(id))),
  );
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
      {groups.length > 0 && (
        <section>
          <h3 className="tidy-head">Possible duplicates</h3>
          <p className="muted tidy-lede">
            Merging keeps the chosen copy and moves the other&rsquo;s annotations, lists, fields,
            relations, tags and details into it, then deletes the other copy for good, in Zotero
            too. The copy with more of your own work is picked first, then the one with more
            details, then the published one. Notes link by title and are not touched.
          </p>
          <ul className="tidy-list">
            {groups.map((group) => (
              <DuplicateRow
                key={`${group.ids.join(",")}:${group.keepId}`}
                group={group}
                byId={byId}
                onMerged={onChanged}
              />
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
        <Button disabled={busy || done || !value.trim()} onClick={() => void apply()}>
          {done ? "Applied" : busy ? "Saving…" : "Apply"}
        </Button>
      </div>
      {error && <FormError>{error}</FormError>}
    </li>
  );
}

function describe(p: (PaperSummary & { venue?: string }) | undefined): string {
  if (!p) return "";
  return [p.year, p.venue, p.pdfPath ? "PDF" : null, enumLabel("paperStatus", p.status), p.doi ? `doi:${p.doi}` : null]
    .filter(Boolean)
    .join(" · ");
}

function DuplicateRow({
  group,
  byId,
  onMerged,
}: {
  group: TidyDuplicateGroup;
  byId: Map<string, PaperSummary & { venue?: string }>;
  onMerged: () => void | Promise<void>;
}) {
  const [keepId, setKeepId] = useState(group.keepId);
  const name = `keep-${group.ids.join("-")}`;

  // Rule D-07: the other copies go at once; the merge runs when the Undo toast
  // closes, and a failed merge says so in a toast.
  function merge() {
    mergeLater({
      keepId,
      ids: group.ids,
      merge: () => getContainer().libraryTidy.merge(keepId, group.ids),
      onMerged,
    });
  }

  return (
    <li className="tidy-row">
      <fieldset className="tidy-group">
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
      {group.conferenceId ? (
        <label className="tidy-option">
          <input
            type="checkbox"
            className="themed-check"
            checked={keepId === group.conferenceId}
            onChange={(e) => setKeepId(e.target.checked ? group.conferenceId! : group.keepId)}
          />
          <span>
            Keep the conference copy and copy my notes into it
            <span className="muted tidy-choice-meta">{byId.get(group.conferenceId)?.venue}</span>
          </span>
        </label>
      ) : null}
      <div className="tidy-actions">
        <Button onClick={merge}>Merge</Button>
      </div>
    </li>
  );
}
