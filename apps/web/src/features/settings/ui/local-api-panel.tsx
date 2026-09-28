"use client";

import { useEffect, useState } from "react";
import { formatError } from "@/lib/format-error";
import { desktop, type DesktopLocalApi } from "@/lib/desktop/desktop-bridge";
import { FormError } from "@/components/form-error";

/**
 * Settings → AI → MCP and the local HTTP surface, desktop only.
 *
 * Off by default. The token is shown once and never again; a new one stops
 * the old one working, and switching off throws the key away.
 */
export function LocalApiPanel() {
  const [state, setState] = useState<DesktopLocalApi | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    let live = true;
    void bridge
      .localApiState()
      .then((value) => {
        if (live) setState(value);
      })
      .catch(() => {
        // An older shell without the channel. The section simply does not appear.
      });
    return () => {
      live = false;
    };
  }, []);

  if (!state) return null;

  // Switching on while already on issues a fresh token.
  const setEnabled = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const bridge = desktop();
      if (!bridge) return;
      const next = await bridge.setLocalApi(enabled);
      setState(next);
      setToken(next.token ?? null);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1200);
    } catch (err) {
      setError(`Copying was blocked. (${formatError(err)})`);
    }
  };

  const mcpUrl = `${state.url}/mcp`;

  return (
    <div id="settings-ai" className="card add-form settings-anchor" role="tabpanel" aria-labelledby="settings-tab-ai">
      <h3 className="settings-group">AI & MCP</h3>
      <p className="muted">
        Let an MCP client such as Claude or Codex read and search your Notes, over HTTP on this
        computer only. The same address serves Obsidian&rsquo;s local REST routes and the Python
        SDK. Nothing outside this computer can reach it.
      </p>
      {error && <FormError>{error}</FormError>}
      <label className="field-inline">
        <input
          type="checkbox"
          className="themed-check"
          checked={state.enabled}
          disabled={busy}
          onChange={(e) => void setEnabled(e.target.checked)}
        />
        Serve MCP at {state.url}
      </label>
      {state.reason && <FormError>{state.reason}</FormError>}
      {state.enabled && (
        <>
          <div className="ai-connection-value">
            <span><small>MCP endpoint</small><code>{mcpUrl}</code></span>
            <button type="button" className="btn-secondary" onClick={() => void copy("url", mcpUrl)}>{copied === "url" ? "Copied" : "Copy"}</button>
          </div>
          <div className="ai-connection-value">
            {token ? (
              <>
                <span><small>Bearer token — shown once, copy it now</small><code>••••••••••••••••••••••••</code></span>
                <button type="button" className="btn-secondary" onClick={() => void copy("token", token)}>{copied === "token" ? "Copied" : "Copy"}</button>
              </>
            ) : (
              <>
                <span><small>Bearer token</small><small className="muted">Hidden once issued. A new one stops the old one working.</small></span>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void setEnabled(true)}>New token</button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
