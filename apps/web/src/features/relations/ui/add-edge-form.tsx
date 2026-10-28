"use client";

import { enumLabel } from "@/lib/enum-label";
import { useState } from "react";
import { RELATION_TYPES, type Paper, type RelationType } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";
import { Field } from "@/components/field";
import { showToast } from "@/lib/toast";
import { linkSentence, sortPapersByTitle } from "./relation-phrase";

/** Form for linking two papers by hand; used inside the Link papers modal. */
export function AddEdgeForm({
  papers,
  onAdded,
  onClose,
}: {
  papers: Paper[];
  /** Called with the paper the new relation starts from. */
  onAdded?: (fromPaper: string) => void;
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
      showToast("Linked");
      setFrom("");
      setTo("");
      onAdded?.(from);
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

  const sorted = sortPapersByTitle(papers);
  const title = (id: string) => papers.find((p) => p.id === id)?.title;
  const sentence = linkSentence(title(from), relation, title(to));
  const paperOptions = sorted.map((p) => (<option key={p.id} value={p.id}>{p.title}</option>));

  return (
    <form className="add-form" onSubmit={submit}>
      <Field label="From">
        <Select value={from} onChange={(e) => setFrom(e.target.value)} searchable={papers.length > 10}>
          <option value="">Pick a paper…</option>
          {paperOptions}
        </Select>
      </Field>
      <Field label="Relation">
        <Select value={relation} onChange={(e) => setRelation(e.target.value as RelationType)}>
          {RELATION_TYPES.map((t) => (<option key={t} value={t}>{enumLabel("relation", t)}</option>))}
        </Select>
      </Field>
      <Field label="To">
        <Select value={to} onChange={(e) => setTo(e.target.value)} searchable={papers.length > 10}>
          <option value="">Pick a paper…</option>
          {paperOptions}
        </Select>
      </Field>
      {sentence && <p className="muted link-preview" aria-live="polite">{sentence}</p>}
      {error && <FormError>{error}</FormError>}
      <div className="form-foot">
        <Button className="btn-cancel" onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>{busy ? "Linking…" : "Link"}</Button>
      </div>
    </form>
  );
}
