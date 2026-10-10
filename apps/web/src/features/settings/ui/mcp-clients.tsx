"use client";

import { useState, type KeyboardEvent } from "react";
import { formatError } from "@/lib/format-error";
import { desktop, type DesktopLocalApi, type DesktopLocalApiPermission } from "@/lib/desktop/desktop-bridge";
import { FormError } from "@/components/form-error";
import {
  MCP_CLIENT_TABS,
  claudeCodeCommands,
  codexToml,
  geminiInstall,
  mcpServersJson,
  vscodeJson,
  type McpClientId,
} from "./mcp-client-config";

const CHIP: Partial<Record<DesktopLocalApiPermission, string>> = {
  "mcp:read": "read & search",
  "mcp:suggest": "drafts",
  experiments: "experiments",
};

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function ago(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : day(iso);
}

/** Settings → AI & MCP: one Connect for every client, then per-client setup. */
export function McpClients({
  state,
  onChange,
  initialTab = "claude-code",
}: {
  state: DesktopLocalApi;
  onChange: (next: DesktopLocalApi) => void;
  initialTab?: McpClientId;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<McpClientId>(initialTab);
  const [copied, setCopied] = useState<string | null>(null);
  const mcp = state.mcp;
  if (!mcp) return null;
  const token = mcp.connected ? state.tokens?.find((t) => t.id === mcp.tokenId) : undefined;

  const act = async (run: () => Promise<DesktopLocalApi | void> | undefined) => {
    setBusy(true);
    setError(null);
    try {
      const next = await run();
      if (next) onChange(next);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  };
  const copy = (key: string, text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    });
  const copyBtn = (key: string, label: string, text: string) => (
    <button type="button" className="btn-secondary" onClick={() => copy(key, text)}>
      {copied === key ? "Copied" : label}
    </button>
  );
  const openBtn = (client: "cursor" | "vscode" | "claude-desktop", label: string) => (
    <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => desktop()?.openMcpClient?.(client))}>
      {label}
    </button>
  );
  const onTabKey = (e: KeyboardEvent) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    const i = MCP_CLIENT_TABS.findIndex((t) => t.id === tab);
    const next = MCP_CLIENT_TABS[(i + step + MCP_CLIENT_TABS.length) % MCP_CLIENT_TABS.length]!;
    setTab(next.id);
    document.getElementById(`mcp-tab-${next.id}`)?.focus();
  };

  const pane = () => {
    switch (tab) {
      case "claude-code":
        return (
          <>
            <div className="mcp-small">Plugin with the research skill. Run once in a terminal:</div>
            <pre>{claudeCodeCommands()}</pre>
            <div className="mcp-row">{copyBtn("cc", "Copy", claudeCodeCommands())}</div>
          </>
        );
      case "claude-desktop":
        return (
          <>
            <div className="mcp-small">Opens Claude Desktop&rsquo;s install dialog for the WeaveForge extension.</div>
            <div className="mcp-row">{openBtn("claude-desktop", "Add to Claude Desktop")}</div>
          </>
        );
      case "codex":
        return (
          <>
            <div className="mcp-small">Add to <span className="mono">~/.codex/config.toml</span>:</div>
            <pre>{codexToml(mcp.launch)}</pre>
            <div className="mcp-row">{copyBtn("cx", "Copy", codexToml(mcp.launch))}</div>
          </>
        );
      case "gemini":
        return (
          <>
            <pre>{geminiInstall()}</pre>
            <div className="mcp-row">{copyBtn("gm", "Copy", geminiInstall())}</div>
          </>
        );
      case "cursor":
        return (
          <>
            <div className="mcp-small">Opens Cursor&rsquo;s own confirm dialog.</div>
            <div className="mcp-row">
              {openBtn("cursor", "Add to Cursor")}
              {copyBtn("cu", "Copy JSON", mcpServersJson(mcp.launch))}
            </div>
          </>
        );
      case "vscode":
        return (
          <>
            <div className="mcp-small">Opens VS Code&rsquo;s own confirm dialog.</div>
            <div className="mcp-row">
              {openBtn("vscode", "Add to VS Code")}
              {copyBtn("vs", "Copy JSON", vscodeJson(mcp.launch))}
            </div>
          </>
        );
      case "other":
        return (
          <>
            <div className="mcp-small">
              Any client that takes <span className="mono">mcpServers</span> JSON (Windsurf, Cline, Zed, opencode, Goose, LM Studio…):
            </div>
            <pre>{mcpServersJson(mcp.launch)}</pre>
            <div className="mcp-small">
              Takes a URL instead? <span className="mono">{mcp.url}</span> plus a Bearer token from Access tokens.
            </div>
            <div className="mcp-row">
              {copyBtn("ot", "Copy JSON", mcpServersJson(mcp.launch))}
              {copyBtn("url", "Copy URL", mcp.url)}
            </div>
          </>
        );
    }
  };

  return (
    <>
      {error && <FormError>{error}</FormError>}
      {mcp.connected && !state.enabled && (
        <FormError>{state.reason ?? "MCP is not being served, so AI clients cannot reach WeaveForge. Tick Serve MCP above."}</FormError>
      )}
      <div className="mcp-client">
        <header>
          <strong>AI clients</strong>
          <span className={mcp.connected ? "mcp-pill on" : "mcp-pill"}>{mcp.connected ? "Connected" : "Not connected"}</span>
        </header>
        {mcp.connected ? (
          <>
            {token && (
              <>
                <div className="mcp-perm">
                  {token.permissions.flatMap((p) => (CHIP[p] ? [<span key={p}>{CHIP[p]}</span>] : []))}
                </div>
                <div className="mcp-small">
                  Token &ldquo;{token.name}&rdquo; · created {day(token.createdAt)} · last used{" "}
                  {token.lastUsedAt ? ago(token.lastUsedAt, Date.now()) : "never"}
                </div>
              </>
            )}
            <div className="mcp-row">
              <button type="button" className="mcp-danger" disabled={busy} onClick={() => void act(() => desktop()?.disconnectMcp?.())}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <div className="mcp-row">
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void act(() => desktop()?.connectMcp?.())}>
              Connect
            </button>
          </div>
        )}
      </div>

      {mcp.connected && (
        <div className="mcp-client mcp-add">
          <header>
            <strong>Add to a client</strong>
          </header>
          <div className="mcp-tabs" role="tablist" aria-label="Client" onKeyDown={onTabKey}>
            {MCP_CLIENT_TABS.map((t) => (
              <button
                key={t.id}
                id={`mcp-tab-${t.id}`}
                type="button"
                role="tab"
                className="mcp-tab"
                aria-selected={t.id === tab}
                aria-controls="mcp-client-pane"
                tabIndex={t.id === tab ? 0 : -1}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div id="mcp-client-pane" className="mcp-pane" role="tabpanel" aria-labelledby={`mcp-tab-${tab}`}>
            {pane()}
          </div>
        </div>
      )}
    </>
  );
}
