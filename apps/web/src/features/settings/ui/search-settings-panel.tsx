"use client";

import { DEFAULT_EMBEDDING_MODEL } from "@/features/search/infrastructure/embedding-models";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
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
import { formatError } from "@/lib/format-error";
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
import { StepProgress, type Step } from "@/components/step-progress";
import { LibraryPdfIndexing, IndexSize } from "./library-pdf-indexing";

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

      <div className="search-weights">
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
      </div>

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
    // Ticked at once: enabling resolves only after the download and the index, and the steps render while on.
    setOn(next);
    try {
      if (next) await enableSemanticSearch();
      else await disableSemanticSearch();
    } catch (err) {
      setOn(!next);
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  const working = status.phase === "downloading" || status.phase === "loading" || status.phase === "embedding";

  return (
    <div className="field field-with-steps">
      <div>
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
      {on && <SemanticSteps status={status} />}
    </div>
  );
}

const SEMANTIC_PHASES = ["downloading", "loading", "embedding"] as const;

/** Download, start, read: one bar per stage beside the toggle. An error marks the stage it broke in. */
function SemanticSteps({ status }: { status: SemanticStatus }) {
  const lastAt = useRef(-1);
  const at =
    status.phase === "error"
      ? lastAt.current
      : status.phase === "ready"
        ? SEMANTIC_PHASES.length
        : SEMANTIC_PHASES.indexOf(status.phase as (typeof SEMANTIC_PHASES)[number]);
  // Remember the stage after commit, not during render, so an error can name it.
  useEffect(() => {
    if (status.phase !== "error") lastAt.current = at;
  });
  const state = (i: number): Step["state"] =>
    i < at ? "done" : i === at ? (status.phase === "error" ? "error" : "active") : "pending";

  const steps: Step[] = [
    {
      label: "Download the model",
      state: state(0),
      value: status.phase === "downloading" ? status.loaded / Math.max(status.total, 1) : undefined,
    },
    { label: "Start the model", state: state(1) },
    {
      label: "Read your workspace",
      state: state(2),
      value: status.phase === "embedding" && status.total ? status.done / status.total : undefined,
      detail:
        status.phase === "embedding" && status.total
          ? `${status.done.toLocaleString()} of ${status.total.toLocaleString()} passages`
          : status.phase === "ready"
            ? `${status.passages.toLocaleString()} passages`
            : undefined,
    },
  ];
  if (status.phase === "ready" && status.upgrading) {
    const up = status.upgrading;
    steps.push({
      label: `Upgrade to ${up.to}`,
      state: "active",
      value: up.total ? up.done / up.total : undefined,
      detail: up.total ? `${up.done.toLocaleString()} of ${up.total.toLocaleString()} passages` : undefined,
    });
  }
  return <StepProgress steps={steps} label="Meaning search setup" />;
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
  return (
    <div className="semantic-status" data-phase={status.phase} aria-live="polite">
      <p className={status.phase === "error" ? "form-error" : "muted"}>{text}</p>
    </div>
  );
}
