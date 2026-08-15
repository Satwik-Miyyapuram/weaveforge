"use client";

import { useState } from "react";
import { RELATION_TYPES, type Paper, type RelationType } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";

/** Form for manually linking two papers; used inside the Add edge modal. */
export function AddEdgeForm({
  papers,
  onAdded,
  onClose,
}: {
  papers: Paper[];
  onAdded?: () => void;
  onClose?: () => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [relation, setRelation] = useState<RelationType>("cites");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!from || !to) { setError("Pick both papers."); return; }
    if (from === to) { setError("A paper can't relate to itself."); return; }
    setBusy(true);
    try {
      await getContainer().graph.addRelation.add({ fromPaper: from, toPaper: to, relation, source: "manual" });
      setFrom("");
      setTo("");
      onAdded?.();
      onClose?.();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  if (papers.length < 2) {
    return <p className="muted">Add at least two papers before linking them.</p>;
  }

  return (
    <form className="add-form" onSubmit={submit}>
      <div className="field">
        <Select id="from" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From paper">
          <option value="">From paper…</option>
          {papers.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
        </Select>
      </div>
      <div className="field">
        <Select id="relation" value={relation} onChange={(e) => setRelation(e.target.value as RelationType)} aria-label="Relation type">
          {RELATION_TYPES.map((t) => (<option key={t} value={t}>{t.replace("_", " ")}</option>))}
        </Select>
      </div>
      <div className="field">
        <Select id="to" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To paper">
          <option value="">To paper…</option>
          {papers.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>))}
        </Select>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="form-foot">
        <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy}>{busy ? "Linking…" : "Add edge"}</button>
      </div>
    </form>
  );
}
