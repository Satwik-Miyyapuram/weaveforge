"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS,
  AI_PROPOSAL_KINDS,
  AI_READ_CATEGORIES,
  aiReadCategoryForResource,
  applyUserIntegrationFields,
  getUserIntegrationField,
  type AiAccessSettings,
  type AiProposalKind,
  type AiReadCategory,
  type UserSettings,
} from "@thesis/core";
import { getContainer } from "@/bootstrap";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";
import type { AiSourceOption } from "@/container/facades";
import { Select } from "@/components/select";
import { ensureRelay, runningRelays, stopAllRelays, stopRelay } from "@/features/ai-assistant/infrastructure/mcp-relay-manager";
import {
  clearPersistedMcpSessions,
  loadPersistedMcpSessions,
  savePersistedMcpSessions,
} from "@/features/ai-assistant/infrastructure/mcp-session-store";

const READ_LABELS: Record<AiReadCategory, string> = {
  paper_metadata: "Paper metadata and links",
  paper_notes: "Paper notes",
  zotero_annotations: "Zotero annotations and notes",
  reading_lists: "Reading lists",
  vault_notes: "Vault notes",
  logbook: "Logbook",
  experiments: "Experiments and milestones",
};

const PROPOSAL_LABELS: Record<AiProposalKind, string> = {
  append_paper_note: "Append to paper notes",
  create_vault_note: "Create a vault note",
  create_log_entry: "Create a log entry",
  paper_update: "Propose paper metadata updates",
  reading_list_change: "Change reading lists",
  relation: "Propose graph relations",
  zotero_import: "Propose Zotero imports",
  milestone_follow_up: "Create milestone follow-ups",
  experiment_follow_up: "Create experiment follow-ups",
};

interface McpTokenRecord {
  id: string;
  name: string;
  tokenPrefix: string;
  lastUsedAt: string | null;
}

export function AiAccessPanel({ settings, onChange }: {
  settings: UserSettings;
  onChange: (settings: UserSettings) => void;
}) {
  const encryptionUnlocked = true;
  const [sources, setSources] = useState<readonly AiSourceOption[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<readonly string[]>([]);
  const [sourceScope, setSourceScope] = useState<"selected" | "enabled_categories">("selected");
  const [ttlMinutes, setTtlMinutes] = useState("30");
  const [workspaceName, setWorkspaceName] = useState("Research workspace");
  const [sessions, setSessions] = useState(() => getContainer().aiAssistant.listActiveSessions());
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ sessionId: string; secret: string } | null>(null);
  const [mcpTokens, setMcpTokens] = useState<readonly McpTokenRecord[]>([]);
  const [newMcpToken, setNewMcpToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [rememberConnection, setRememberConnection] = useState(() => Boolean(getUserIntegrationField(settings, "mcp", "pairingSecret")));
  const access: AiAccessSettings = settings.aiAccess ?? {
    enabled: false,
    readCategories: [],
    proposalKinds: [],
  };
  const eligibleSources = sources.filter((source) => access.readCategories.includes(aiReadCategoryForResource(source.resourceType)));
  const sourcesByCategory = eligibleSources.reduce<Record<string, AiSourceOption[]>>((groups, source) => {
    (groups[source.category] ??= []).push(source);
    return groups;
  }, {});

  function toggleRead(category: AiReadCategory) {
    const readCategories = access.readCategories.includes(category)
      ? access.readCategories.filter((item) => item !== category)
      : [...access.readCategories, category];
    onChange({ ...settings, aiAccess: { ...access, readCategories } });
  }

  function toggleProposal(kind: AiProposalKind) {
    if (AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.includes(kind)) return;
    const proposalKinds = access.proposalKinds.includes(kind)
      ? access.proposalKinds.filter((item) => item !== kind)
      : [...access.proposalKinds, kind];
    onChange({ ...settings, aiAccess: { ...access, proposalKinds } });
  }

  function setAllRead(enabled: boolean) {
    onChange({ ...settings, aiAccess: { ...access, readCategories: enabled ? [...AI_READ_CATEGORIES] : [] } });
  }

  function setAllProposals(enabled: boolean) {
    onChange({ ...settings, aiAccess: { ...access, proposalKinds: enabled ? AI_PROPOSAL_KINDS.filter((kind) => !AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.includes(kind)) : [] } });
  }

  function toggleDynamic(category: AiReadCategory) {
    const current = access.autoIncludeNewSourceCategories ?? [];
    const autoIncludeNewSourceCategories = current.includes(category)
      ? current.filter((item) => item !== category)
      : [...current, category];
    onChange({ ...settings, aiAccess: { ...access, autoIncludeNewSourceCategories } });
  }

  useEffect(() => {
    if (!access.enabled || !encryptionUnlocked) {
      setSources([]);
      return;
    }
    void getContainer().aiAssistant.listSourceOptions().then(setSources).catch(() => setSources([]));
  }, [access.enabled, encryptionUnlocked]);

  const loadMcpTokens = useCallback(async () => {
    const accessToken = await getContainer().auth.auth.getAccessToken();
    if (!accessToken) return;
    const response = await fetch("/api/settings/mcp-tokens", { headers: { Authorization: `Bearer ${accessToken}` } });
    const payload = await response.json() as { tokens?: McpTokenRecord[] };
    if (response.ok) setMcpTokens(payload.tokens ?? []);
  }, []);

  useEffect(() => {
    if (!access.enabled || !encryptionUnlocked) {
      setMcpTokens([]);
      return;
    }
    void loadMcpTokens();
  }, [access.enabled, encryptionUnlocked, loadMcpTokens]);

  // Snapshot the currently running sessions (grant + secret + settings) to
  // session-scoped storage so a reload can resume the relays until they expire.
  const persistSessions = useCallback(() => {
    const active = getContainer().aiAssistant.listActiveSessions();
    const meta = new Map(runningRelays().map((entry) => [entry.sessionId, entry]));
    const list = active.flatMap((session) => {
      const extra = meta.get(session.grant.id);
      return extra ? [{ session, secret: extra.secret, settings: extra.settings }] : [];
    });
    void savePersistedMcpSessions(list);
  }, []);

  // Rehydrate persisted sessions after a reload: restore the grants and restart
  // their relays (skipping any already running and any past their TTL).
  useEffect(() => {
    if (!access.enabled || !encryptionUnlocked) return;
    let cancelled = false;
    void loadPersistedMcpSessions().then((persisted) => {
      if (cancelled || persisted.length === 0) return;
      const ai = getContainer().aiAssistant;
      const now = Date.now();
      const live = persisted.filter((record) => Date.parse(record.session.grant.expiresAt) > now);
      ai.restoreActiveSessions(live.map((record) => record.session));
      for (const record of live) {
        ensureRelay(record.session.grant.id, record.secret, record.settings);
      }
      setSessions(ai.listActiveSessions());
      if (live.length !== persisted.length) {
        void savePersistedMcpSessions(live.map((record) => ({ session: record.session, secret: record.secret, settings: record.settings })));
      }
    });
    return () => { cancelled = true; };
  }, [access.enabled, encryptionUnlocked]);

  // Push tightened AI access into any live relay without restarting the poll loop.
  useEffect(() => {
    for (const entry of runningRelays()) {
      ensureRelay(entry.sessionId, entry.secret, access);
    }
  }, [access]);

  function toggleSource(sourceId: string) {
    setSelectedSourceIds((current) => current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId]);
  }

  async function startSession() {
    setBusy(true);
    setSessionError(null);
    const sourceIds = sourceScope === "enabled_categories"
      ? eligibleSources.map((source) => source.sourceId)
      : selectedSourceIds;
    try {
      const session = await getContainer().aiAssistant.startSession({
        workspaceName,
        sourceIds,
        settings: access,
        proposalCapabilities: access.proposalKinds,
        ttlMinutes: Number(ttlMinutes),
      });
      const remembered = getUserIntegrationField(settings, "mcp", "pairingSecret");
      const secret = remembered ?? (crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""));
      if (rememberConnection && !remembered) onChange(applyUserIntegrationFields(settings, "mcp", { pairingSecret: secret }));
      ensureRelay(session.grant.id, secret, access);
      setConnection({ sessionId: session.grant.id, secret });
      setSessions(getContainer().aiAssistant.listActiveSessions());
      persistSessions();
      setSelectedSourceIds([]);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function createMcpToken() {
    setBusy(true);
    setSessionError(null);
    try {
      const accessToken = await getContainer().auth.auth.getAccessToken();
      if (!accessToken) throw new Error("Sign in to create an MCP token.");
      const response = await fetch("/api/settings/mcp-tokens", { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json() as { plaintext?: string; record?: McpTokenRecord; error?: string };
      if (!response.ok || !payload.plaintext) throw new Error(payload.error ?? "Could not create MCP token.");
      setNewMcpToken(payload.plaintext);
      if (payload.record) setMcpTokens((current) => [payload.record!, ...current]);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function revokeMcpToken(id: string) {
    if (!window.confirm("Revoke this MCP token? Any Codex connection using it will stop immediately.")) return;
    setBusy(true);
    setSessionError(null);
    try {
      const accessToken = await getContainer().auth.auth.getAccessToken();
      if (!accessToken) throw new Error("Sign in to revoke an MCP token.");
      const response = await fetch(`/api/settings/mcp-tokens?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not revoke MCP token.");
      setMcpTokens((current) => current.filter((token) => token.id !== id));
      setNewMcpToken(null);
    } catch (err) {
      setSessionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function revokeAll() {
    stopAllRelays();
    setConnection(null);
    getContainer().aiAssistant.revokeAll();
    void clearPersistedMcpSessions();
    setSessions([]);
  }

  function setEnabled(enabled: boolean) {
    if (!enabled) revokeAll();
    onChange({
      ...settings,
      aiAccess: {
        ...access,
        enabled,
        disclosureAcceptedAt: enabled ? access.disclosureAcceptedAt ?? new Date().toISOString() : undefined,
      },
    });
  }

  async function copyConnection(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1200);
    } catch {
      setSessionError("Your browser blocked copying this value. Allow clipboard access and try again.");
    }
  }

  if (!GENERATED_MCP_ENABLED) return null;

  return (
    <section className="ai-access-panel" aria-labelledby="ai-access-title">
      <header className="ai-access-hero">
        <div>
          <p className="ai-eyebrow">Private by default</p>
          <h3 id="ai-access-title">AI assistant access</h3>
          <p>Connect a client such as Codex to only the research sources you choose. PDFs, keys, and account settings are never shared.</p>
        </div>
        <button type="button" className={`toggle${access.enabled ? " on" : ""}`} role="switch" aria-checked={access.enabled} aria-label="Enable AI assistant access" onClick={() => setEnabled(!access.enabled)}><span className="knob" /></button>
      </header>
      {access.enabled && (
        <>
          <section className="ai-section">
            <div className="ai-section-heading">
              <div><h4>Allow reading</h4><p>Only selected sources become available.</p></div>
              <button type="button" className="link-btn" onClick={() => setAllRead(access.readCategories.length !== AI_READ_CATEGORIES.length)}>{access.readCategories.length === AI_READ_CATEGORIES.length ? "Clear all" : "Select all"}</button>
            </div>
            <div className="ai-permission-list ai-list-2col">
              {AI_READ_CATEGORIES.map((category) => (
                <label className="ai-permission-row" key={category}>
                  <span>{READ_LABELS[category]}</span>
                  <input className="themed-check" type="checkbox" checked={access.readCategories.includes(category)} onChange={() => toggleRead(category)} />
                </label>
              ))}
            </div>
          </section>
          <section className="ai-section">
            <div className="ai-section-heading">
              <div><h4>Allow proposals</h4><p>{access.proposalKinds.length ? `${access.proposalKinds.length} proposal types enabled — every change still needs your review` : "Every change needs your review first."}</p></div>
              <button type="button" className="link-btn" onClick={() => setAllProposals(access.proposalKinds.length === 0)}>{access.proposalKinds.length ? "Clear all" : "Select all"}</button>
            </div>
            <div className="ai-permission-list ai-list-2col">
              {AI_PROPOSAL_KINDS.map((kind) => (
                <label className="ai-permission-row" key={kind}>
                  <span>{PROPOSAL_LABELS[kind]}{AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.includes(kind) && <small>Unavailable until Zotero writing is enabled</small>}</span>
                  <input className="themed-check" type="checkbox" checked={access.proposalKinds.includes(kind)} disabled={AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS.includes(kind)} onChange={() => toggleProposal(kind)} />
                </label>
              ))}
            </div>
          </section>
          <details className="ai-section ai-section--collapsible">
            <summary>
              <div className="ai-section-heading">
                <div><h4>Include new sources automatically</h4><p>Off by default. New sources join only the categories you choose here.</p></div>
                <span className="chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></span>
              </div>
            </summary>
            <div className="ai-permission-list ai-list-2col">{AI_READ_CATEGORIES.map((category) => <label className="ai-permission-row" key={`dynamic-${category}`}><span>{READ_LABELS[category]}</span><input className="themed-check" type="checkbox" disabled={!access.readCategories.includes(category)} checked={(access.autoIncludeNewSourceCategories ?? []).includes(category)} onChange={() => toggleDynamic(category)} /></label>)}</div>
          </details>
          <section className="ai-section ai-session-section">
            <div className="ai-section-heading"><div><h4>Active access</h4><p>Sessions expire after 30 minutes and end when you revoke them.</p></div></div>
            {!encryptionUnlocked && <p className="error">Unlock encryption to select sources and start a session.</p>}
            {encryptionUnlocked && (
              <>
                <div className="field">
                  <label htmlFor="ai-workspace-name">Workspace name</label>
                  <input id="ai-workspace-name" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} />
                </div>
                <div className="ai-session-duration">
                  <div><strong>Access duration</strong><small>Access ends automatically when the timer expires.</small></div>
                  <Select id="ai-session-duration" value={ttlMinutes} onChange={(event) => setTtlMinutes(event.target.value)} aria-label="AI access duration">
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="45">45 minutes</option>
                    <option value="60">1 hour</option>
                    <option value="1440">1 day</option>
                    <option value="10080">1 week</option>
                  </Select>
                </div>
                <label className="ai-master-toggle"><span><strong>Remember this Codex connection on this device</strong><small>Stores only the pairing secret in your encrypted settings. Sessions still expire and require an unlocked browser.</small></span><input className="themed-check" type="checkbox" checked={rememberConnection} onChange={(event) => { setRememberConnection(event.target.checked); if (!event.target.checked) onChange(applyUserIntegrationFields(settings, "mcp", { pairingSecret: "" })); }} /></label>
                <div className="ai-mcp-token-control">
                  <div><strong>MCP token</strong><small>Create one token for this Codex plugin connection. It does not expire, is shown only once, and can be revoked here at any time.</small></div>
                  <button type="button" className="btn-secondary" onClick={() => void createMcpToken()} disabled={busy}>{mcpTokens.length ? "Create replacement" : "Create MCP token"}</button>
                </div>
                {newMcpToken && <div className="ai-connection-value"><span><small>New MCP token — copy it now</small><code>••••••••••••••••••••••••</code></span><button type="button" className="btn-secondary" onClick={() => copyConnection("token", newMcpToken)}>{copied === "token" ? "Copied" : "Copy"}</button></div>}
                {mcpTokens.length > 0 && <div className="ai-token-list"><small>{mcpTokens.length} active MCP token{mcpTokens.length === 1 ? "" : "s"}</small>{mcpTokens.map((token) => <div className="ai-active-session" key={token.id}><span><strong>{token.name}</strong><small>{token.tokenPrefix} · {token.lastUsedAt ? `last used ${new Date(token.lastUsedAt).toLocaleDateString()}` : "not used yet"}</small></span><button type="button" className="link-btn danger" onClick={() => void revokeMcpToken(token.id)} disabled={busy}>Revoke</button></div>)}</div>}
                <div className="ai-source-scope">
                  <div>
                    <strong>Source access</strong>
                    <small>{sourceScope === "selected" ? "Choose individual sources for this session." : "Use every current source in your enabled read categories."}</small>
                  </div>
                  <Select value={sourceScope} onChange={(event) => setSourceScope(event.target.value as "selected" | "enabled_categories")} aria-label="Source access mode">
                    <option value="selected">Select sources</option>
                    <option value="enabled_categories">All enabled categories</option>
                  </Select>
                </div>
                {eligibleSources.length === 0 ? <p className="muted">Enable a read category, then select sources from this project.</p> : (
                  sourceScope === "selected" && <>
                    <div className="ai-source-picker-toolbar">
                      <span>{selectedSourceIds.length} of {eligibleSources.length} selected</span>
                      <span><button type="button" className="link-btn" onClick={() => setSelectedSourceIds(eligibleSources.map((source) => source.sourceId))}>Select all</button><button type="button" className="link-btn" onClick={() => setSelectedSourceIds([])}>Clear</button></span>
                    </div>
                    <div className="ai-source-groups">
                      {Object.entries(sourcesByCategory).map(([category, categorySources]) => {
                        const allSelected = categorySources.every((source) => selectedSourceIds.includes(source.sourceId));
                        return <details className="ai-source-group" key={category}>
                          <summary><span><strong>{category}</strong><small>{categorySources.filter((source) => selectedSourceIds.includes(source.sourceId)).length} of {categorySources.length} selected</small></span><span className="chev"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg></span></summary>
                          <div className="ai-source-group-actions"><button type="button" className="link-btn" onClick={() => setSelectedSourceIds((current) => allSelected ? current.filter((id) => !categorySources.some((source) => source.sourceId === id)) : [...new Set([...current, ...categorySources.map((source) => source.sourceId)])])}>{allSelected ? "Clear category" : "Select category"}</button></div>
                          {categorySources.map((source) => <label className="ai-permission-row" key={source.sourceId}>
                            <span>{source.label}</span><input className="themed-check" type="checkbox" checked={selectedSourceIds.includes(source.sourceId)} onChange={() => toggleSource(source.sourceId)} />
                          </label>)}
                        </details>;
                      })}
                    </div>
                  </>
                )}
                <button type="button" className="btn-secondary ai-start-access" onClick={() => void startSession()} disabled={busy || (sourceScope === "selected" ? selectedSourceIds.length === 0 : eligibleSources.length === 0)}>
                  {busy ? "Starting…" : `Start access for ${sourceScope === "selected" ? selectedSourceIds.length : eligibleSources.length} source${(sourceScope === "selected" ? selectedSourceIds.length : eligibleSources.length) === 1 ? "" : "s"}`}
                </button>
                {sessionError && <p className="error">{sessionError}</p>}
                {connection && <div className="ai-connection-details"><div className="ai-section-heading"><div><h4>Live Codex connection</h4><p>Copy this session ID and pairing secret into the local plugin. Use the MCP token you created above. Keep this page open and encryption unlocked.</p></div></div><div className="ai-connection-value"><span><small>Session ID</small><code>{connection.sessionId}</code></span><button type="button" className="btn-secondary" onClick={() => copyConnection("session", connection.sessionId)}>{copied === "session" ? "Copied" : "Copy"}</button></div><div className="ai-connection-value"><span><small>Pairing secret</small><code>••••••••••••••••••••••••••••••••</code></span><button type="button" className="btn-secondary" onClick={() => copyConnection("secret", connection.secret)}>{copied === "secret" ? "Copied" : "Copy"}</button></div></div>}
              </>
            )}
            {sessions.length > 0 && (
              <div className="ai-active-sessions">
                {sessions.map((session) => (
                  <div className="ai-active-session" key={session.grant.id}>
                    <span><strong>{session.workspace.name}</strong><small>{session.grant.readable.length} source{session.grant.readable.length === 1 ? "" : "s"} · expires {new Date(session.grant.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span>
                    <button type="button" className="link-btn danger" onClick={() => {
                      stopRelay(session.grant.id);
                      if (connection?.sessionId === session.grant.id) setConnection(null);
                      getContainer().aiAssistant.revokeSession(session.grant.id);
                      setSessions(getContainer().aiAssistant.listActiveSessions());
                      persistSessions();
                    }}>Revoke now</button>
                  </div>
                ))}
                <button type="button" className="link-btn danger" onClick={revokeAll}>Disable all active AI access</button>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
