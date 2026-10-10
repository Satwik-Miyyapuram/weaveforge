"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { FormError } from "@/components/form-error";
import { LocalApiTokenCreate, LocalApiTokenTable, useLocalApiState } from "@/components/local-api-tokens";
import { McpClients } from "./mcp-clients";

/**
 * Settings → AI → MCP and the local HTTP surface, desktop only.
 *
 * Off by default. Up to five tokens, each with its own permissions and expiry.
 */
export function LocalApiPanel({ purpose = "mcp" }: { purpose?: "mcp" | "sdk" }) {
  const [state, setState] = useLocalApiState();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!state) return null;

  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const bridge = desktop();
      if (!bridge) return;
      setState(await bridge.setLocalApi(enabled));
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const mcpUrl = `${state.url}/mcp`;
  const sdk = purpose === "sdk";

  return (
    <div
      id={sdk ? "settings-tokens" : "settings-ai"}
      className="card add-form settings-anchor"
      role="tabpanel"
      aria-labelledby={sdk ? "settings-tab-tokens" : "settings-tab-ai"}
    >
      <h3 className="settings-group">{sdk ? "Access tokens on this computer" : "AI & MCP"}</h3>
      {sdk ? (
        <p className="muted">
          Tokens for the Python SDK (Experiments), Obsidian-style Notes REST routes and MCP clients.
          Each gets only the permissions you tick. They reach this app over HTTP on this computer
          only, so it has to be running. A token is shown once; only its hash is kept.
        </p>
      ) : (
        <p className="muted">
          Let an AI client read and search your workspace and leave drafts for you to approve.
          Everything stays on this computer, and WeaveForge has to be open.
        </p>
      )}
      {error && <FormError>{error}</FormError>}
      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void setEnabled(e.target.checked)}
        />
        {sdk ? "Serve the local API" : "Serve MCP"} at {state.url}
      </label>
      {!sdk && state.mcp && <McpClients state={state} onChange={setState} />}
      {state.enabled && !(!sdk && state.mcp) && (
        <>
          {!sdk && (
            <div className="ai-connection-value">
              <span><small>MCP endpoint</small><code>{mcpUrl}</code></span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  void navigator.clipboard.writeText(mcpUrl).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  })
                }
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}
          {sdk ? (
            <>
              <LocalApiTokenTable state={state} onChange={setState} />
              <LocalApiTokenCreate state={state} onChange={setState} />
            </>
          ) : (
            <small className="muted">Create and revoke tokens in Settings → Access tokens.</small>
          )}
        </>
      )}
    </div>
  );
}
