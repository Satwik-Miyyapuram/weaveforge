"use client";

import { useEffect, useState } from "react";
import {
  MAX_FIELD_WEIGHT,
  MIN_FIELD_WEIGHT,
  SEARCH_KINDS,
  effectiveFieldBoosts,
  type SearchField,
  type SearchKind,
  type SearchSettings,
} from "@thesis/core";
import { MultiSelect } from "@/components/multi-select";
import {
  indexLibraryPdfs,
  papersNeedingIndex,
  type LibraryIndexProgress,
} from "@/features/search/application/index-library-pdfs";
import { formatError } from "@/lib/format-error";
import { getContainer } from "@/bootstrap";

/** Fields a user can reweight, with names that mean something outside the code. */
const FIELD_LABELS: Record<SearchField, string> = {
  title: "Title",
  aliases: "Authors, aliases, identifiers",
  headings: "Headings",
  tags: "Tags",
  path: "Folder path",
  body: "Body text",
};

const KIND_LABELS: Record<SearchKind, string> = {
  note: "Notes",
  paper: "Papers",
  list: "Reading lists",
  section: "Report sections",
  experiment: "Experiments",
  milestone: "Milestones",
  log: "Logbook entries",
  pdf: "PDF page text",
  annotation: "Highlights and their comments",
};

export function SearchSettingsPanel({
  value,
  onChange,
}: {
  value: SearchSettings | undefined;
  onChange: (next: SearchSettings) => void;
}) {
  const boosts = effectiveFieldBoosts(value);

  const setWeight = (field: SearchField, weight: number) => {
    onChange({ ...value, weights: { ...(value?.weights ?? {}), [field]: weight } });
  };

  return (
    <div
      id="settings-search"
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby="settings-tab-search"
    >
      <h3 className="settings-group">Search</h3>
      <p className="muted" style={{ margin: "4px 0 12px" }}>
        How results are ranked. Higher weight means a match in that field counts for more.
      </p>

      {(Object.keys(FIELD_LABELS) as SearchField[]).map((field) => (
        <div className="field" key={field}>
          <label htmlFor={`search-weight-${field}`}>
            {FIELD_LABELS[field]} — {boosts[field]}
          </label>
          <input
            id={`search-weight-${field}`}
            type="range"
            min={MIN_FIELD_WEIGHT}
            max={MAX_FIELD_WEIGHT}
            step={1}
            value={boosts[field]}
            onChange={(e) => setWeight(field, Number(e.target.value))}
          />
        </div>
      ))}

      <div className="field">
        <label htmlFor="search-downranked">Push these down the results</label>
        <MultiSelect
          id="search-downranked"
          allLabel="Nothing downranked"
          ariaLabel="Kinds to push down the results"
          options={SEARCH_KINDS.map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
          values={[...(value?.downrankedKinds ?? [])]}
          onChange={(kinds) => onChange({ ...value, downrankedKinds: kinds as SearchKind[] })}
        />
        <p className="muted jump-to-meta">
          Downranked kinds still appear — they just sort below everything else.
        </p>
      </div>

      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={value?.recencyBoost !== false}
          onChange={(e) => onChange({ ...value, recencyBoost: e.target.checked })}
        />
        Prefer recently edited items when scores tie
      </label>

      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={value?.ignoreArabicDiacritics === true}
          onChange={(e) => onChange({ ...value, ignoreArabicDiacritics: e.target.checked })}
        />
        Ignore Arabic diacritics when matching
      </label>

      <LibraryPdfIndexing />
      <IndexSize />
    </div>
  );
}

/**
 * Index every PDF, not just the ones already opened.
 *
 * Kept as an explicit action with a count shown first, because this is the one
 * part of search that costs anything: a paper you have never opened has to be
 * downloaded before it can be read. Opening a PDF indexes it for free, so most
 * people never need this.
 */
function LibraryPdfIndexing() {
  const [pending, setPending] = useState<number | null>(null);
  const [progress, setProgress] = useState<LibraryIndexProgress | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check() {
    setBusy(true);
    setError(null);
    setDone(null);
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
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <label htmlFor="index-library">Search inside PDFs</label>
      <p className="muted jump-to-meta">
        PDFs are indexed as you read them, at no cost. Indexing the whole library downloads every
        paper you have not opened yet, so it is a deliberate step.
      </p>
      {error && <p className="error">{error}</p>}
      {progress && (
        <p className="muted" aria-live="polite">
          {progress.done} of {progress.total}
          {progress.current ? ` — ${progress.current}` : ""}
        </p>
      )}
      {done && <p className="muted">{done}</p>}
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
          <button className="btn-secondary" type="button" disabled={busy} onClick={() => void run()}>
            {busy ? "Indexing…" : `Index ${pending} PDF${pending === 1 ? "" : "s"}`}
          </button>
        )}
      </div>
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
function IndexSize() {
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

  return (
    <p className="muted jump-to-meta">
      {size.documents.toLocaleString()} item{size.documents === 1 ? "" : "s"} indexed
      {size.large
        ? " — large enough that searching may feel slow on a modest device. PDF pages are usually most of it."
        : "."}
    </p>
  );
}
