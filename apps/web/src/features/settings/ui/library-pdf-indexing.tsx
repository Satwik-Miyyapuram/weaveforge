"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  indexLibraryPdfs,
  papersNeedingIndex,
  type LibraryIndexProgress,
} from "@/features/search/application/index-library-pdfs";
import {
  autoIndexEnabled,
  autoIndexStatus,
  setAutoIndexEnabled,
  subscribeAutoIndex,
} from "@/features/search/application/auto-index-library";
import { formatError } from "@/lib/format-error";
import { getContainer } from "@/bootstrap";
import {
  WEB_CACHE_DOCUMENT_LIMIT,
  isInstalledApp,
  shouldPersistIndex,
} from "@/features/search/infrastructure/index-cache-policy";
import { FormError } from "@/components/form-error";
import { StepProgress, type Step } from "@/components/step-progress";

/**
 * Index every PDF, not just the ones already opened.
 *
 * Kept as an explicit action with a count shown first, because this is the one
 * part of search that costs anything: a paper you have never opened has to be
 * downloaded before it can be read. Opening a PDF indexes it for free, so most
 * people never need this.
 */
export function LibraryPdfIndexing() {
  const [pending, setPending] = useState<number | null>(null);
  const [progress, setProgress] = useState<LibraryIndexProgress | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Why each paper could not be read.
   *
   * "Indexed 0, 18 could not be read" says what happened and nothing about what
   * to do; a host refusing cross-origin reads is not something the reader can
   * fix, a 404 is a dead link they can, and the two used to look identical.
   */
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [auto, setAuto] = useState(false);
  const background = useSyncExternalStore(subscribeAutoIndex, autoIndexStatus, autoIndexStatus);

  useEffect(() => setAuto(autoIndexEnabled()), []);
  // A background run's outcome is shown the same way as the button's.
  useEffect(() => {
    if (background.last) setReasons(background.last.reasons);
  }, [background.last]);
  const shown = progress ?? background.progress;

  async function check() {
    setBusy(true);
    setError(null);
    setDone(null);
    setReasons({});
    try {
      setPending((await papersNeedingIndex()).length);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const papers = await papersNeedingIndex();
      const result = await indexLibraryPdfs(papers, { onProgress: setProgress });
      setProgress(null);
      setPending(0);
      setDone(
        `Indexed ${result.indexed}` +
          (result.skipped ? `, skipped ${result.skipped} with no reachable file` : "") +
          (result.failed ? `, ${result.failed} could not be read` : "") +
          ".",
      );
      setReasons(result.reasons);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const steps: Step[] = [
    {
      label: "Find papers without text",
      state: pending !== null || shown || done ? "done" : busy ? "active" : "pending",
      detail: pending !== null && !shown && !done ? `${pending} to index` : undefined,
    },
    {
      label: background.running && !progress ? "Fetch and index PDFs (background)" : "Fetch and index PDFs",
      state: shown ? "active" : done || pending === 0 ? "done" : "pending",
      value: shown ? shown.done / Math.max(shown.total, 1) : undefined,
      detail: shown ? `${shown.done} of ${shown.total}${shown.current ? ` — ${shown.current}` : ""}` : undefined,
    },
  ];

  return (
    <div className="field field-with-steps">
      <div>
        <label htmlFor="index-library">Search inside PDFs</label>
        <p className="muted jump-to-meta">
          PDFs are indexed as you read them, at no cost. Indexing the whole library fetches every
          paper you have not opened yet — from arXiv and the other open-access hosts, not from us,
          so it pauses a few seconds between papers to stay a welcome guest. Expect it to run in
          the background for a while on a large library.
        </p>
        <label className="field-inline">
          <input
            type="checkbox"
            className="themed-check"
            checked={auto}
            onChange={(e) => {
              setAuto(e.target.checked);
              setAutoIndexEnabled(e.target.checked);
            }}
          />
          Index new papers automatically
        </label>
        {error && <FormError>{error}</FormError>}
        {!shown && !done && background.last && (
          <p className="muted">
            Last background run: indexed {background.last.indexed}
            {background.last.failed ? `, ${background.last.failed} could not be read (retried in a week)` : ""}.
          </p>
        )}
        {done && <p className="muted">{done}</p>}
        {/*
          What could not be read, and why. Grouped by reason rather than listed per
          paper: eighteen lines all saying the same thing is noise, and the reason
          is the part that tells the reader whether to do anything.
        */}
        {Object.keys(reasons).length > 0 && (
          <ul className="wiki-lint-list">
            {Object.entries(
              Object.entries(reasons).reduce<Record<string, string[]>>((groups, [title, why]) => {
                (groups[why] ??= []).push(title);
                return groups;
              }, {}),
            ).map(([why, titles]) => (
              <li key={why} data-severity="info">
                <strong>{titles.length}</strong> — {why}
                {titles.length <= 3 && <span className="jump-to-meta"> ({titles.join(", ")})</span>}
              </li>
            ))}
          </ul>
        )}
        {pending !== null && !progress && !done && (
          <p className="muted">
            {pending === 0
              ? "Every PDF in your library is already indexed."
              : `${pending} paper${pending === 1 ? "" : "s"} not yet indexed.`}
          </p>
        )}
        <div className="screen-actions">
          <button
            id="index-library"
            className="btn-secondary"
            type="button"
            disabled={busy}
            onClick={() => void check()}
          >
            Check what is missing
          </button>
          {pending !== null && pending > 0 && (
            <button className="btn-secondary" type="button" disabled={busy || background.running} onClick={() => void run()}>
              {busy ? "Indexing…" : `Index ${pending} PDF${pending === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
      {(pending !== null || shown || done) && <StepProgress steps={steps} label="PDF indexing" />}
    </div>
  );
}

/**
 * What the index currently holds.
 *
 * Reported rather than enforced. The index lives in this browser, so past a
 * few thousand documents it is worth knowing about — but silently dropping
 * documents to stay under a threshold would make search quietly wrong, and
 * whole-library PDF indexing is the one knob that moves this number a lot.
 */
export function IndexSize() {
  const [size, setSize] = useState<{ documents: number; large: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getContainer()
      .search.ensure()
      .then(() => {
        if (!cancelled) setSize(getContainer().search.corpusSize);
      })
      .catch(() => {
        /* the panel is informational; a failed build surfaces where search is used */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!size) return null;

  const cached = shouldPersistIndex(size.documents);

  return (
    <>
      <p className="muted jump-to-meta">
        {size.documents.toLocaleString()} item{size.documents === 1 ? "" : "s"} indexed
        {size.large
          ? " — large enough that searching may feel slow on a modest device. PDF pages are usually most of it."
          : "."}
      </p>
      {!cached && (
        <p className="muted jump-to-meta">
          Too large to keep between visits in a browser tab, so it is rebuilt each session — in
          the background, not while you wait. Above {WEB_CACHE_DOCUMENT_LIMIT.toLocaleString()}{" "}
          items the cache costs more to write than the rebuild it saves.{" "}
          {!isInstalledApp() && "Installing the app keeps it on this device instead."}
        </p>
      )}
    </>
  );
}
