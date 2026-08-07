"use client";

import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { Select } from "@/components/select";
import { useAuth } from "@/features/auth";
import { formatError, readJsonBody } from "@/lib/format-error";

interface ApiTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

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
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState("90");
  const [busy, setBusy] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTokens([]);
    try {
      const accessToken = await getContainer().auth.auth.getAccessToken();
      if (!accessToken) throw new Error("Sign in to manage API tokens.");

      const res = await fetch("/api/settings/api-tokens", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await readJsonBody(res);
      if (!res.ok) {
        setError(formatError(payload.error ?? payload));
        return;
      }
      const raw = payload.tokens;
      setTokens(Array.isArray(raw) ? (raw as ApiTokenRecord[]) : []);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, user?.id]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const accessToken = await getContainer().auth.auth.getAccessToken();
      if (!accessToken) throw new Error("Sign in to create tokens.");

      const opt = EXPIRY_OPTIONS.find((o) => o.value === expiry) ?? EXPIRY_OPTIONS[2];
      const res = await fetch("/api/settings/api-tokens", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, expiresInDays: opt.days }),
      });
      const payload = await readJsonBody(res);
      if (!res.ok) {
        setError(formatError(payload.error ?? payload));
        return;
      }
      const record = payload.record as ApiTokenRecord | undefined;
      if (record) setTokens((prev) => [record, ...prev]);
      setRevealed(typeof payload.plaintext === "string" ? payload.plaintext : null);
      setCreateOpen(false);
      setName("");
      setExpiry("90");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!window.confirm("Revoke this token? Scripts using it will stop working immediately.")) return;
    setError(null);
    try {
      const accessToken = await getContainer().auth.auth.getAccessToken();
      if (!accessToken) throw new Error("Sign in to revoke tokens.");

      const res = await fetch(`/api/settings/api-tokens?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = await readJsonBody(res);
      if (!res.ok) {
        setError(formatError(payload.error ?? payload));
        return;
      }
      setTokens((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      setError(formatError(err));
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

      {error ? <p className="error">{error}</p> : null}

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
              <button type="button" className="link-btn danger" onClick={() => void handleRevoke(t.id)}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}

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
