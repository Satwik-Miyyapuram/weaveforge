"use client";

import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import type { McpTokenRecord } from "@/container/facades";
import { formatDate } from "@/lib/format-date";
import { formatError } from "@/lib/format-error";
import { FormError } from "@/components/form-error";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/button";

/**
 * The tokens an AI client such as Codex signs in to the MCP relay with. They
 * sit on Settings › Access tokens with every other kind (DA-132); the AI
 * access dialog links here instead of keeping a list of its own.
 */
export function McpTokensPanel() {
  const [tokens, setTokens] = useState<readonly McpTokenRecord[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    getContainer().settings.mcpTokens.list().then(
      (list) => { if (current) setTokens(list); },
      (err: unknown) => { if (current) setError(formatError(err)); },
    );
    return () => { current = false; };
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { plaintext, record } = await getContainer().settings.mcpTokens.create();
      setFresh(plaintext);
      setCopied(false);
      if (record) setTokens((list) => [record, ...list]);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      await getContainer().settings.mcpTokens.revoke(id);
      setTokens((list) => list.filter((token) => token.id !== id));
      setFresh(null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
      setRevoking(null);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the token and copy it by hand.");
    }
  }

  return (
    <div id="settings-mcp-tokens" className="card add-form settings-anchor">
      <h3 className="settings-group">AI client (MCP) tokens</h3>
      <p className="muted">
        An AI client such as Codex signs in with one of these. A token does not expire and is shown
        only once, so copy it when you make it.
      </p>
      <FormError>{error}</FormError>
      <div className="api-token-toolbar">
        <Button variant="primary" onClick={() => void create()} disabled={busy}>
          {tokens.length ? "Create replacement" : "Create MCP token"}
        </Button>
      </div>
      {fresh && (
        <div className="ai-connection-value">
          <span><small>New MCP token — copy it now</small><code>••••••••••••••••••••••••</code></span>
          <Button onClick={() => void copy(fresh)}>{copied ? "Copied" : "Copy"}</Button>
        </div>
      )}
      {tokens.length === 0 ? (
        <p className="muted">No MCP tokens yet.</p>
      ) : (
        <ul className="api-token-list">
          {tokens.map((token) => (
            <li key={token.id} className="api-token-row">
              <div className="api-token-main">
                <strong>{token.name}</strong>
                <span className="muted mono">{token.tokenPrefix}</span>
              </div>
              <div className="api-token-meta muted">
                <span>{token.lastUsedAt ? `Last used ${formatDate(token.lastUsedAt)}` : "Not used yet"}</span>
              </div>
              <Button size="sm" className="danger" onClick={() => setRevoking(token.id)} disabled={busy}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
      {revoking ? (
        <ConfirmDialog
          title="Revoke this MCP token?"
          body="Any AI client using it stops working at once."
          confirmLabel="Revoke"
          danger
          busy={busy}
          onConfirm={() => void revoke(revoking)}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </div>
  );
}
