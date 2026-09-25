"use client";

import { DEFAULT_EMBEDDING_MODEL } from "@/features/search/infrastructure/embedding-models";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  MAX_FIELD_WEIGHT,
  MIN_FIELD_WEIGHT,
  SEARCH_KINDS,
  effectiveFieldBoosts,
  type SearchField,
  type SearchKind,
  type SearchSettings,
} from "@weaveforge/core";
import { MultiSelect } from "@/components/multi-select";
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
import {
  disableSemanticSearch,
  enableSemanticSearch,
  restoreSemanticSearch,
  semanticEnabled,
  semanticStatus,
  semanticSupported,
  subscribeSemanticStatus,
  type SemanticStatus,
} from "@/features/search/application/semantic-search";
import { FormError } from "@/components/form-error";

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

      <SemanticSearchToggle />
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

  return (
    <div className="field">
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
      {shown && (
        <p className="muted" aria-live="polite">
          {background.running && !progress ? "In the background: " : ""}
          {shown.done} of {shown.total}
          {shown.current ? ` — ${shown.current}` : ""}
        </p>
      )}
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

/**
 * Meaning-based search, opt-in.
 *
 * Off by default, and the copy says what it costs before the button is pressed.
 * A one-time download of tens of megabytes and a pass over the whole corpus is
 * not something to start on someone's behalf — least of all on a phone or a
 * metered connection.
 */
function SemanticSearchToggle() {
  const status = useSyncExternalStore(subscribeSemanticStatus, semanticStatus, semanticStatus);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const enabled = semanticEnabled();
    setOn(enabled);
    // Opening the panel is reason enough to bring the arm up if it was left on;
    // otherwise it waits for the first search, and the panel would report
    // "off" for a feature the reader turned on.
    if (enabled) void restoreSemanticSearch();
  }, []);

  if (!semanticSupported()) {
    return (
      <p className="muted jump-to-meta">
        Meaning-based search needs Web Workers and WebAssembly, which this browser does not offer.
        Keyword search is unaffected.
      </p>
    );
  }

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      if (next) await enableSemanticSearch();
      else await disableSemanticSearch();
      setOn(next);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const working = status.phase === "downloading" || status.phase === "loading" || status.phase === "embedding";

  return (
    <div className="field">
      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={on}
          disabled={busy || working}
          onChange={(e) => void toggle(e.target.checked)}
        />
        Also search by meaning, not just words
      </label>
      <p className="muted jump-to-meta">
        Finds a passage that answers your question even when it shares no words with it. Runs
        entirely on this device: a one-time ~{DEFAULT_EMBEDDING_MODEL.downloadMb} MB model download, then a pass over your
        workspace. Keyword search keeps working throughout, and both are combined in the results.
      </p>

      {error && <FormError>{error}</FormError>}
      {on && <SemanticStatusLine status={status} />}
    </div>
  );
}

/** One line saying what the arm is doing, and when it is done, that it works. */
function SemanticStatusLine({ status }: { status: SemanticStatus }) {
  const text = (() => {
    switch (status.phase) {
      case "downloading":
        return `Downloading the model — ${Math.round((status.loaded / Math.max(status.total, 1)) * 100)}%`;
      case "loading":
        return "Starting the model…";
      case "embedding":
        return status.total
          ? `Reading your workspace — ${status.done.toLocaleString()} of ${status.total.toLocaleString()} passages`
          : "Reading your workspace…";
      case "ready":
        return status.upgrading
          ? `On (${status.model}). Upgrading to ${status.upgrading.to} in the background${
              status.upgrading.total
                ? ` — ${status.upgrading.done.toLocaleString()} of ${status.upgrading.total.toLocaleString()} passages`
                : "…"
            }. Search keeps using the current model until it is done.`
          : `On — ${status.passages.toLocaleString()} passages searchable by meaning (${status.model}). New and edited items are added as you work.`;
      case "error":
        return `Not working: ${status.message}. Keyword search is unaffected.`;
      default:
        return "Waiting to start…";
    }
  })();
  const progress =
    status.phase === "embedding" && status.total
      ? status.done / status.total
      : status.phase === "ready" && status.upgrading?.total
        ? status.upgrading.done / status.upgrading.total
      : status.phase === "downloading"
        ? status.loaded / Math.max(status.total, 1)
        : null;
  return (
    <div className="semantic-status" data-phase={status.phase} aria-live="polite">
      <p className={status.phase === "error" ? "form-error" : "muted"}>{text}</p>
      {progress !== null && <progress max={1} value={progress} />}
    </div>
  );
}
