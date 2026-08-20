"use client";

import { useCallback, useEffect, useState } from "react";
import {
  PAPER_FIELD_KINDS,
  computeRollup,
  type Paper,
  type PaperFieldDef,
  type PaperFieldKind,
  type PaperFieldRollupAgg,
  type PaperFieldValue,
  type PaperFieldValueData,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatError } from "@/lib/format-error";
import { Select } from "@/components/select";

/**
 * Project-scoped custom fields: inline values on the paper + a small manager
 * for define / rename / remove.
 */
export function PaperFieldsStrip({ paperId, readOnly }: { paperId: string; readOnly: boolean }) {
  const [defs, setDefs] = useState<PaperFieldDef[]>([]);
  const [values, setValues] = useState<Map<string, PaperFieldValueData>>(new Map());
  const [projectValues, setProjectValues] = useState<PaperFieldValue[]>([]);
  const [library, setLibrary] = useState<Paper[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [managing, setManaging] = useState(false);

  const reload = useCallback(async () => {
    const papers = getContainer().papers;
    const [nextDefs, nextValues, allValues, screen] = await Promise.all([
      papers.listPaperFieldDefs(),
      papers.listPaperFieldValuesForPaper(paperId),
      papers.listPaperFieldValuesForProject(),
      papers.loadScreenData(),
    ]);
    setDefs(nextDefs);
    setValues(new Map(nextValues.map((v: PaperFieldValue) => [v.fieldId, v.value])));
    setProjectValues(allValues);
    setLibrary(screen.papers);
  }, [paperId]);

  useEffect(() => {
    let cancelled = false;
    void reload().catch((error) => {
      if (!cancelled) setMsg(formatError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function saveValue(fieldId: string, value: PaperFieldValueData | null) {
    setBusy(true);
    setMsg(null);
    try {
      await getContainer().papers.setPaperFieldValue(paperId, fieldId, value);
      await reload();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  if (defs.length === 0 && readOnly) return null;

  return (
    <div className="paper-fields">
      <div className="muted paper-fields-head">
        Custom fields
        {msg ? ` · ${msg}` : ""}
        {!readOnly && (
          <button
            type="button"
            className="link-btn"
            onClick={() => setManaging((open) => !open)}
          >
            {managing ? "Done" : "Manage"}
          </button>
        )}
      </div>

      {defs.length === 0 ? (
        <p className="muted paper-fields-empty">No fields yet — use Manage to add one.</p>
      ) : (
        <div className="paper-fields-grid">
          {defs.map((def) => {
            const rollupValue =
              def.kind === "rollup"
                ? computeRollup(paperId, def, defs, projectValues)
                : undefined;
            return (
              <PaperFieldEditor
                key={def.id}
                def={def}
                value={def.kind === "rollup" ? (rollupValue ?? undefined) : values.get(def.id)}
                papers={library.filter((p) => p.id !== paperId)}
                disabled={busy || readOnly || def.kind === "rollup"}
                onChange={(next) => void saveValue(def.id, next)}
              />
            );
          })}
        </div>
      )}

      {managing && !readOnly && (
        <PaperFieldsManager
          defs={defs}
          busy={busy}
          setBusy={setBusy}
          setMsg={setMsg}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function PaperFieldEditor({
  def,
  value,
  papers = [],
  disabled,
  onChange,
}: {
  def: PaperFieldDef;
  value: PaperFieldValueData | undefined;
  papers?: Paper[];
  disabled: boolean;
  onChange: (next: PaperFieldValueData | null) => void;
}) {
  const textValue = typeof value === "string" ? value : "";
  const numberValue = typeof value === "number" ? String(value) : "";
  const multiValue = Array.isArray(value) ? value : [];
  const [draft, setDraft] = useState(
    def.kind === "number" ? numberValue : textValue,
  );

  useEffect(() => {
    setDraft(def.kind === "number" ? numberValue : textValue);
  }, [def.kind, numberValue, textValue]);

  function commitText() {
    const trimmed = draft.trim();
    const current = typeof value === "string" ? value : "";
    if (trimmed === current) return;
    onChange(trimmed || null);
  }

  function commitNumber() {
    const current = typeof value === "number" ? String(value) : "";
    if (draft.trim() === current) return;
    if (draft.trim() === "") {
      onChange(null);
      return;
    }
    const n = Number(draft);
    if (!Number.isFinite(n)) {
      setDraft(current);
      return;
    }
    onChange(n);
  }

  return (
    <label className="paper-field-row">
      <span className="paper-field-label">{def.name}</span>
      {def.kind === "text" && (
        <input
          type="text"
          className="paper-field-input"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitText}
        />
      )}
      {def.kind === "number" && (
        <input
          type="number"
          className="paper-field-input"
          value={draft}
          disabled={disabled}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitNumber}
        />
      )}
      {def.kind === "select" && (
        <Select
          value={textValue}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={def.name}
        >
          <option value="">—</option>
          {def.options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </Select>
      )}
      {(def.kind === "multi_select" || def.kind === "relation") && (
        <div className="paper-field-multi">
          {(def.kind === "relation" ? papers : def.options.map((opt) => ({ id: opt, title: opt }))).length === 0 ? (
            <span className="muted">No options</span>
          ) : def.kind === "relation" ? (
            papers.map((p) => {
              const checked = multiValue.includes(p.id);
              return (
                <label key={p.id} className="paper-field-check">
                  <input
                    type="checkbox"
                    className="themed-check"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      const next = checked
                        ? multiValue.filter((x) => x !== p.id)
                        : [...multiValue, p.id];
                      onChange(next.length ? next : null);
                    }}
                  />
                  {p.title}
                </label>
              );
            })
          ) : (
            def.options.map((opt) => {
              const checked = multiValue.includes(opt);
              return (
                <label key={opt} className="paper-field-check">
                  <input
                    type="checkbox"
                    className="themed-check"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => {
                      const next = checked
                        ? multiValue.filter((x) => x !== opt)
                        : [...multiValue, opt];
                      onChange(next.length ? next : null);
                    }}
                  />
                  {opt}
                </label>
              );
            })
          )}
        </div>
      )}
      {def.kind === "rollup" && (
        <span className="paper-field-rollup">
          {value == null ? "—" : Array.isArray(value) ? value.join(", ") : String(value)}
        </span>
      )}
    </label>
  );
}

function PaperFieldsManager({
  defs,
  busy,
  setBusy,
  setMsg,
  onChanged,
}: {
  defs: PaperFieldDef[];
  busy: boolean;
  setBusy: (v: boolean) => void;
  setMsg: (v: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<PaperFieldKind>("text");
  const [optionsText, setOptionsText] = useState("");
  const [relationFieldId, setRelationFieldId] = useState("");
  const [rollupAgg, setRollupAgg] = useState<PaperFieldRollupAgg>("count");
  const [sourceFieldId, setSourceFieldId] = useState("");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const needsOptions = kind === "select" || kind === "multi_select";
  const relationDefs = defs.filter((d) => d.kind === "relation");
  const sourceDefs = defs.filter(
    (d) => d.kind !== "relation" && d.kind !== "rollup",
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setMsg(null);
    try {
      await action();
      await onChanged();
    } catch (error) {
      setMsg(formatError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paper-fields-manager">
      <ul className="paper-fields-def-list">
        {defs.map((def) => (
          <li key={def.id} className="paper-fields-def-row">
            {renameId === def.id ? (
              <>
                <input
                  type="text"
                  className="paper-field-input"
                  value={renameName}
                  disabled={busy}
                  onChange={(e) => setRenameName(e.target.value)}
                  aria-label={`Rename ${def.name}`}
                />
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await getContainer().papers.renamePaperField(def.id, renameName);
                      setRenameId(null);
                    })
                  }
                >
                  Save
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => setRenameId(null)}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span>
                  {def.name}{" "}
                  <span className="muted">({def.kind.replace("_", " ")})</span>
                </span>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    setRenameId(def.id);
                    setRenameName(def.name);
                  }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={busy}
                  onClick={() => {
                    if (!confirm(`Remove field "${def.name}"? Values on papers will be deleted.`)) {
                      return;
                    }
                    void run(() => getContainer().papers.removePaperField(def.id));
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="paper-fields-add">
        <input
          type="text"
          className="paper-field-input"
          placeholder="New field name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
        <Select
          value={kind}
          disabled={busy}
          onChange={(e) => setKind(e.target.value as PaperFieldKind)}
          aria-label="Field kind"
        >
          {PAPER_FIELD_KINDS.map((k) => (
            <option key={k} value={k}>{k.replace("_", " ")}</option>
          ))}
        </Select>
        {needsOptions && (
          <input
            type="text"
            className="paper-field-input"
            placeholder="Options, comma-separated"
            value={optionsText}
            disabled={busy}
            onChange={(e) => setOptionsText(e.target.value)}
          />
        )}
        {kind === "rollup" && (
          <>
            <Select
              value={relationFieldId}
              disabled={busy || relationDefs.length === 0}
              onChange={(e) => setRelationFieldId(e.target.value)}
              aria-label="Rollup relation field"
            >
              <option value="">Relation field…</option>
              {relationDefs.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
            <Select
              value={rollupAgg}
              disabled={busy}
              onChange={(e) => setRollupAgg(e.target.value as PaperFieldRollupAgg)}
              aria-label="Rollup aggregation"
            >
              <option value="count">count</option>
              <option value="values">values</option>
              <option value="sum">sum</option>
              <option value="avg">avg</option>
            </Select>
            {rollupAgg !== "count" && (
              <Select
                value={sourceFieldId}
                disabled={busy || sourceDefs.length === 0}
                onChange={(e) => setSourceFieldId(e.target.value)}
                aria-label="Rollup source field"
              >
                <option value="">Source field…</option>
                {sourceDefs.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </Select>
            )}
          </>
        )}
        <button
          type="button"
          className="btn-secondary"
          disabled={
            busy ||
            !name.trim() ||
            (kind === "rollup" &&
              (!relationFieldId || (rollupAgg !== "count" && !sourceFieldId)))
          }
          onClick={() =>
            void run(async () => {
              await getContainer().papers.definePaperField({
                name,
                kind,
                options: needsOptions
                  ? optionsText.split(",").map((s) => s.trim()).filter(Boolean)
                  : undefined,
                rollup:
                  kind === "rollup"
                    ? {
                        relationFieldId,
                        agg: rollupAgg,
                        sourceFieldId: rollupAgg === "count" ? undefined : sourceFieldId,
                      }
                    : undefined,
              });
              setName("");
              setOptionsText("");
              setRelationFieldId("");
              setSourceFieldId("");
              setRollupAgg("count");
              setKind("text");
            })
          }
        >
          Add field
        </button>
      </div>
    </div>
  );
}
