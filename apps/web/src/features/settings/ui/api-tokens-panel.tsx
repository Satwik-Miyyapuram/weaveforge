"use client";

import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";
import { useAuth } from "@/features/auth";
import { formatError } from "@/lib/format-error";
import { useSubmit } from "@/lib/hooks/use-submit";
import type { ApiTokenRecord } from "@/container/facades";

const EXPIRY_OPTIONS = [
  { value: "0", label: "Never expires", days: null as number | null },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "90", label: "90 days", days: 90 },
  { value: "365", label: "1 year", days: 365 },
] as const;

function formatWhen(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Personal access tokens for the Python SDK. */
export function ApiTokensPanel() {
  const { user } = useAuth();
  const [tokens, setTokens] = useState<ApiTokenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  /** The token awaiting a revoke confirmation, by id. */
  const [revoking, setRevoking] = useState<string | null>(null);

  const { busy, error, setError, submit: handleCreate } = useSubmit(async () => {
    const opt = EXPIRY_OPTIONS.find((o) => o.value === expiry) ?? EXPIRY_OPTIONS[2];
    const payload = await getContainer().settings.apiTokens.create({
      name,
      expiresInDays: opt.days,
    });
    const record = payload.record;
    if (record) setTokens((prev) => [record, ...prev]);
    setRevealed(typeof payload.plaintext === "string" ? payload.plaintext : null);
    setCreateOpen(false);
    setName("");
    setExpiry("90");
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTokens([]);
    try {
      setTokens(await getContainer().settings.apiTokens.list());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void load();
  }, [load, user?.id]);


  async function handleRevoke(id: string) {
    setError(null);
    try {
      await getContainer().settings.apiTokens.revoke(id);
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setRevoking(null);
    }
  }

  return (
    <div id="settings-tokens" className="card add-form settings-anchor" style={{ marginBottom: "24px" }}>
      <h3 className="settings-group">Python SDK access tokens</h3>
      <p className="muted api-token-intro">
        Generate personal access tokens for the{" "}
        <a href="https://pypi.org/project/weaveforge/" target="_blank" rel="noreferrer">
          weaveforge
        </a>{" "}
        Python package. Use them in scripts and notebooks to push experiments, metrics, and
        artifacts into this workspace — without sharing your login session.
      </p>
      <pre className="api-token-env-hint">
        pip install weaveforge{"\n"}
        export WEAVEFORGE_TOKEN=tt_…{"\n"}
        export WEAVEFORGE_API_URL=https://your-app.example.com
      </pre>

      <FormError>{error}</FormError>

      <div className="api-token-toolbar">
        <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
          Generate token
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading tokens…</p>
      ) : tokens.length === 0 ? (
        <p className="muted">No tokens yet. Generate one when you need SDK access.</p>
      ) : (
        <ul className="api-token-list">
          {tokens.map((t) => (
            <li key={t.id} className="api-token-row">
              <div className="api-token-main">
                <strong>{t.name}</strong>
                <span className="muted mono">{t.tokenPrefix}</span>
              </div>
              <div className="api-token-meta muted">
                <span>Created {formatWhen(t.createdAt)}</span>
                <span>Expires {formatWhen(t.expiresAt)}</span>
                <span>Last used {formatWhen(t.lastUsedAt)}</span>
              </div>
              <button type="button" className="link-btn danger" onClick={() => setRevoking(t.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* The confirmation the app draws, in place of `window.confirm`. */}
      {revoking ? (
        <ConfirmDialog
          title="Revoke this token?"
          body={`Scripts using “${tokens.find((t) => t.id === revoking)?.name ?? "this token"}” will stop working immediately.`}
          confirmLabel="Revoke"
          danger
          onConfirm={() => void handleRevoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      ) : null}

      {createOpen ? (
        <Modal title="Generate API token" onClose={() => setCreateOpen(false)}>
          <form className="add-form" onSubmit={(e) => void handleCreate(e)}>
            <p className="muted" style={{ marginTop: 0 }}>
              The full token is shown once. Store it somewhere safe — you cannot view it again.
            </p>
            <div className="field">
              <label htmlFor="token-name">Name</label>
              <input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. MacBook training scripts"
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label htmlFor="token-expiry">Expiration</label>
              <Select id="token-expiry" value={expiry} onChange={(e) => setExpiry(e.target.value)}>
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>
            <button className="btn-primary" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create token"}
            </button>
          </form>
        </Modal>
      ) : null}

      {revealed ? (
        <Modal title="Copy your new token" onClose={() => setRevealed(null)}>
          <p className="muted" style={{ marginTop: 0 }}>
            This is the only time the token will be displayed.
          </p>
          <div className="field">
            <input className="mono" value={revealed} readOnly aria-label="New API token" />
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              void navigator.clipboard.writeText(revealed).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
          >
            {copied ? "Copied" : "Copy token"}
          </button>
        </Modal>
      ) : null}
    </div>
  );
}
