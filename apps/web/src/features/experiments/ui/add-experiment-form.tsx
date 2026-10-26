"use client";

import { useState } from "react";
import {
  EXPERIMENT_STATUSES,
  type ExperimentStatus,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { formatError } from "@/lib/format-error";
import { statusLabel } from "@/components/status-select";
import { FormError } from "@/components/form-error";
import { Button } from "@/components/button";

export function AddExperimentForm({ onAdded }: { onAdded: (id: string) => void }) {
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [commit, setCommit] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [config, setConfig] = useState("");
  const [status, setStatus] = useState<ExperimentStatus>("planned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let parsed: Record<string, unknown> | undefined;
      if (config.trim()) {
        try { parsed = JSON.parse(config); }
        catch (err) { throw new Error(`Config must be valid JSON: ${formatError(err)}`); }
      }
      const exp = await getContainer().experiments.manageExperiment.add({
        name, branch: branch || undefined, commitSha: commit || undefined,
        repoUrl: repoUrl || undefined, status, config: parsed,
      });
      setName(""); setBranch(""); setCommit(""); setRepoUrl(""); setConfig("");
      onAdded(exp.id);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="ename">Name</label>
        <input id="ename" value={name} onChange={(e) => setName(e.target.value)} placeholder="beta-vae sweep β=4" required />
      </div>
      <div className="field-row">
        <div className="field"><label htmlFor="ebranch">Branch</label><input id="ebranch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" /></div>
        <div className="field"><label htmlFor="ecommit">Commit</label><input id="ecommit" value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="a1b2c3d" /></div>
        <div className="field">
          <label htmlFor="estatus">Status</label>
          <Select id="estatus" value={status} onChange={(e) => setStatus(e.target.value as ExperimentStatus)}>
            {EXPERIMENT_STATUSES.map((st) => <option key={st} value={st}>{statusLabel(st)}</option>)}
          </Select>
        </div>
      </div>
      <div className="field"><label htmlFor="erepo">Repo URL</label><input id="erepo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/you/thesis-experiments" /></div>
      <div className="field"><label htmlFor="econfig">Config (JSON)</label><textarea id="econfig" rows={2} value={config} onChange={(e) => setConfig(e.target.value)} placeholder='{"beta":4,"latent_dim":32,"seed":0}' /></div>
      {error && <FormError>{error}</FormError>}
      <Button variant="primary" disabled={busy}>{busy ? "Creating…" : "Create"}</Button>
    </form>
  );
}
