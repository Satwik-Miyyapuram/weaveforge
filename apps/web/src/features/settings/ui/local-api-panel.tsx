"use client";

import { useState } from "react";
import { formatError } from "@/lib/format-error";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { FormError } from "@/components/form-error";
import { LocalApiTokenCreate, LocalApiTokenTable, useLocalApiState } from "@/components/local-api-tokens";
import { McpClients } from "./mcp-clients";
import { copyText } from "@/lib/parts";
import { Button } from "@/components/button";
import { Switch } from "@/components/controls";
import { ConfirmDialog } from "@/components/confirm-dialog";

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
  const [asking, setAsking] = useState(false);

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
      className="add-form settings-anchor"
      role="tabpanel"
      aria-labelledby={sdk ? "settings-tab-tokens" : "settings-tab-ai"}
    >
      <h3 className="settings-group">{sdk ? "Access tokens on this computer" : "AI & MCP"}</h3>
      {sdk ? (
        <p className="muted">
          A token lets a program on this computer use this app: a training script logging runs to
          Experiments (<code>pip install weaveforge</code>, then set <code>WEAVEFORGE_PROJECT</code> to
          the project&rsquo;s name), another notes app reading your Notes, or an AI client. Each token can
          do only what you tick, and works only while WeaveForge is open. It is shown once, when you
          make it, so copy it then.
        </p>
      ) : (
        <p className="muted">
          Let an AI client read and search your workspace and leave drafts for you to approve.
          Everything stays on this computer, and WeaveForge has to be open.
        </p>
      )}
      {error && <FormError>{error}</FormError>}
      <div className="integration-enable">
        <span>
          {sdk ? "Let programs on this computer connect" : "Serve MCP"}
          <small className="muted mono"> {state.url}</small>
        </span>
        <Switch
          checked={state.enabled}
          label={sdk ? "Let programs on this computer connect" : "Serve MCP"}
          disabled={busy}
          onChange={(on) => (on ? setAsking(true) : void setEnabled(false))}
        />
      </div>
      {asking && (
        <ConfirmDialog
          title={sdk ? "Turn on program access?" : "Turn on AI access?"}
          body={
            sdk
              ? "Programs on this computer with a token you make can then use this app while it is open."
              : "AI clients on this computer with a token you make can then read and search your workspace and leave drafts for you to approve."
          }
          confirmLabel="Turn on"
          onConfirm={() => {
            setAsking(false);
            void setEnabled(true);
          }}
          onClose={() => setAsking(false)}
        />
      )}
      {!sdk && state.mcp && <McpClients state={state} onChange={setState} />}
      {state.enabled && !(!sdk && state.mcp) && (
        <>
          {!sdk && (
            <div className="ai-connection-value">
              <span><small>MCP endpoint</small><code>{mcpUrl}</code></span>
              <Button
                onClick={() =>
                  void copyText(mcpUrl).then((ok) => {
                    if (!ok) return;
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1200);
                  })
                }
              >
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          {sdk ? (
            <>
              <LocalApiTokenTable state={state} onChange={setState} />
              <LocalApiTokenCreate state={state} onChange={setState} />
            </>
          ) : (
            <small className="muted">Create and revoke tokens on <a href="#settings-tokens">Access tokens</a>.</small>
          )}
        </>
      )}
    </div>
  );
}
