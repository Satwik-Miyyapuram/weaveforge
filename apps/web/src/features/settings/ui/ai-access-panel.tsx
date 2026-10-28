"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AI_CREDENTIAL_PROTECTED_PROPOSAL_KINDS, AI_PROPOSAL_KINDS, AI_READ_CATEGORIES, aiReadCategoryForResource, applyUserIntegrationFields, getUserIntegrationField, type AiAccessSettings, type AiProposalKind, type AiReadCategory, type UserSettings } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { GENERATED_MCP_ENABLED } from "@/deployment/generated-registry";
import { hasServerRoutes } from "@/deployment/capabilities";
import type { AiSourceOption } from "@/container/facades";
import { Select } from "@/components/select";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";
import { ChevronIcon } from "@/components/chevron-icon";
import { logToApp } from "@/lib/error-report/app-log";
import { Button } from "@/components/button";
import { Switch } from "@/components/controls";

const READ_LABELS: Record<AiReadCategory, string> = {
  paper_metadata: "Paper metadata and links",
  paper_notes: "Paper notes",
  zotero_annotations: "Zotero annotations and notes",
  reading_lists: "Reading lists",
  vault_notes: "Notes",
  logbook: "Logbook",
  experiments: "Experiments and milestones",
};

const PROPOSAL_LABELS: Record<AiProposalKind, string> = {
  append_paper_note: "Append to paper notes",
  create_vault_note: "Create a vault note",
  create_log_entry: "Create a log entry",
  paper_update: "Propose paper metadata updates",
  paper_field_value: "Propose extraction-table field values",
  reading_list_change: "Change reading lists",
  relation: "Propose graph relations",
  zotero_import: "Propose Zotero imports",
  milestone_follow_up: "Create milestone follow-ups",
  experiment_follow_up: "Create experiment follow-ups",
  edit_vault_note: "Suggest note edits",
  append_vault_note: "Suggest additions to notes",
  report_edit: "Suggest report section notes",
  milestone_status: "Suggest milestone status changes",
  experiment_update: "Suggest experiment updates",
  paper_annotation: "Suggest paper highlights",
};

const DEFAULT_AI_ACCESS: AiAccessSettings = {
  enabled: false,
  readCategories: [],
  proposalKinds: [],
};

type SessionStore = Pick<
  ReturnType<typeof getContainer>["aiAssistant"],
  "listActiveSessions" | "runningRelays" | "savePersistedSessions"
>;

/**
 * Snapshot the running sessions (grant + secret + settings) to session-scoped
 * storage so a reload can resume the relays until they expire. A failed save
 * only costs that resume, so it is logged rather than shown.
 */
export function persistActiveSessions(ai: SessionStore): void {
  const meta = new Map(ai.runningRelays().map((entry) => [entry.sessionId, entry]));
  const list = ai.listActiveSessions().flatMap((session) => {
    const extra = meta.get(session.grant.id);
    return extra ? [{ session, secret: extra.secret, settings: extra.settings }] : [];
  });
  ai.savePersistedSessions(list).catch((err) =>
    logToApp({ level: "warn", source: "ai-access", message: "Could not save active AI sessions", detail: String(err) }),
  );
}

export function AiAccessPanel({ settings, onChange, onManageTokens }: {
  settings: UserSettings;
  onChange: (settings: UserSettings) => void;
  /** MCP tokens live on Settings › Access tokens with every other kind (DA-132). */
  onManageTokens: () => void;
}) {
  const [sources, setSources] = useState<readonly AiSourceOption[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<readonly string[]>([]);
  const [sourceScope, setSourceScope] = useState<"selected" | "enabled_categories">("selected");
  const [ttlMinutes, setTtlMinutes] = useState("30");
  const [workspaceName, setWorkspaceName] = useState("Research workspace");
  const [sessions, setSessions] = useState(() => getContainer().aiAssistant.listActiveSessions());
  const [busy, setBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ sessionId: string; secret: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [rememberConnection, setRememberConnection] = useState(() => Boolean(getUserIntegrationField(settings, "mcp", "pairingSecret")));
  const access: AiAccessSettings = settings.aiAccess ?? DEFAULT_AI_ACCESS;
  /** Blocks empty persist until first rehydrate attempt finishes (avoids wiping ciphertext). */
  const [sessionsReady, setSessionsReady] = useState(false);
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

  /*
   * Guarded because the gate can close while the read is in flight. Switching
   * AI access off clears the list synchronously, and
   * without this the resolving promise puts it straight back — the panel then
   * shows the user's sources behind a gate that is shut.
   */
  useEffect(() => {
    if (!access.enabled) {
      setSources([]);
      return;
    }
    let current = true;
    void getContainer()
      .aiAssistant.listSourceOptions()
      .then((s) => {
        if (current) setSources(s);
      })
      .catch(() => {
        if (current) setSources([]);
      });
    return () => {
      current = false;
    };
  }, [access.enabled]);

  const persistSessions = useCallback(() => persistActiveSessions(getContainer().aiAssistant), []);

  // Rehydrate persisted sessions after a reload: restore the grants and restart
  // their relays (skipping any already running and any past their TTL).
  useEffect(() => {
    if (!access.enabled) {
      setSessionsReady(true);
      return;
    }
    let cancelled = false;
    setSessionsReady(false);
    void getContainer().aiAssistant
      .loadPersistedSessions()
      .then((persisted) => {
        if (cancelled) return;
        if (persisted.length === 0) return;
        const ai = getContainer().aiAssistant;
        const now = Date.now();
        const live = persisted.filter((record) => Date.parse(record.session.grant.expiresAt) > now);
        ai.restoreActiveSessions(live.map((record) => record.session));
        for (const record of live) {
          // Prefer live AI access over a looser persisted snapshot.
          ai.ensureRelay(record.session.grant.id, record.secret, access);
        }
        setSessions(ai.listActiveSessions());
        // Persist is owned by the sessionsReady effect so we never race a later
        // startSession() write with this rehydrate snapshot.
      })
      .catch((err) =>
        logToApp({ level: "warn", source: "ai-access", message: "Could not resume AI sessions", detail: String(err) }),
      )
      .finally(() => {
        if (!cancelled) setSessionsReady(true);
      });
    return () => { cancelled = true; };
    // Rehydrate once per enable/unlock — live policy push is the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [access.enabled]);

  // Push tightened AI access into any live relay without restarting the poll loop.
  useEffect(() => {
    if (!sessionsReady) return;
    const ai = getContainer().aiAssistant;
    for (const entry of ai.runningRelays()) {
      ai.ensureRelay(entry.sessionId, entry.secret, access);
    }
    persistSessions();
  }, [access, persistSessions, sessionsReady]);

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
      getContainer().aiAssistant.ensureRelay(session.grant.id, secret, access);
      setConnection({ sessionId: session.grant.id, secret });
      setSessions(getContainer().aiAssistant.listActiveSessions());
      persistSessions();
      setSelectedSourceIds([]);
    } catch (err) {
      setSessionError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  function revokeAll() {
    const ai = getContainer().aiAssistant;
    ai.stopAllRelays();
    setConnection(null);
    ai.revokeAll();
    void ai.clearPersistedSessions();
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
    } catch (err) {
      setSessionError(`Your browser blocked copying this value. Allow clipboard access and try again. (${formatError(err)})`);
    }
  }

  // The relay this panel drives is a server-side queue paired with a token
  // minted at `/api/settings/mcp-tokens`, and a static export has neither. Left
  // on, the panel offered a "Create MCP token" button that could only throw, and
  // started a poller asking `/api/mcp/relay/browser` for work every few seconds
  // forever — a 404 each time, from a request that could never be answered. Same
  // argument as `apiTokens` in `deployment/capabilities.ts`.
  if (!GENERATED_MCP_ENABLED || !hasServerRoutes()) return null;

  return (
    <section className="ai-access-panel" aria-labelledby="ai-access-title">
      <header className="ai-access-hero">
        <div>
          <p className="ai-eyebrow">Private by default</p>
          <h3 id="ai-access-title">AI assistant access</h3>
          <p>Connect a client such as Codex to only the research sources you choose. PDFs, keys, and account settings are never shared.</p>
        </div>
        <Switch checked={access.enabled} label="Enable AI assistant access" onClick={() => setEnabled(!access.enabled)} />
      </header>
      {access.enabled && (
        <>
          <section className="ai-section">
            <div className="ai-section-heading">
              <div><h4>Allow reading</h4><p>Only selected sources become available.</p></div>
              <Button variant="ghost" size="sm" onClick={() => setAllRead(access.readCategories.length !== AI_READ_CATEGORIES.length)}>{access.readCategories.length === AI_READ_CATEGORIES.length ? "Clear all" : "Select all"}</Button>
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
              <Button variant="ghost" size="sm" onClick={() => setAllProposals(access.proposalKinds.length === 0)}>{access.proposalKinds.length ? "Clear all" : "Select all"}</Button>
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
                <ChevronIcon />
              </div>
            </summary>
            <div className="ai-permission-list ai-list-2col">{AI_READ_CATEGORIES.map((category) => <label className="ai-permission-row" key={`dynamic-${category}`}><span>{READ_LABELS[category]}</span><input className="themed-check" type="checkbox" disabled={!access.readCategories.includes(category)} checked={(access.autoIncludeNewSourceCategories ?? []).includes(category)} onChange={() => toggleDynamic(category)} /></label>)}</div>
          </details>
          <section className="ai-section ai-session-section">
            <div className="ai-section-heading"><div><h4>Active access</h4><p>Sessions end when the access duration below runs out, or when you revoke them.</p></div></div>
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
                  <div><strong>MCP token</strong><small>Codex signs in with an MCP token. Make, copy and revoke them on Settings › Access tokens.</small></div>
                  <Button onClick={onManageTokens}>Manage MCP tokens</Button>
                </div>
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
                      <span><Button variant="ghost" size="sm" onClick={() => setSelectedSourceIds(eligibleSources.map((source) => source.sourceId))}>Select all</Button><Button variant="ghost" size="sm" onClick={() => setSelectedSourceIds([])}>Clear</Button></span>
                    </div>
                    <div className="ai-source-groups">
                      {Object.entries(sourcesByCategory).map(([category, categorySources]) => {
                        const allSelected = categorySources.every((source) => selectedSourceIds.includes(source.sourceId));
                        return <details className="ai-source-group" key={category}>
                          <summary><span><strong>{category}</strong><small>{categorySources.filter((source) => selectedSourceIds.includes(source.sourceId)).length} of {categorySources.length} selected</small></span><ChevronIcon /></summary>
                          <div className="ai-source-group-actions"><Button variant="ghost" size="sm" onClick={() => setSelectedSourceIds((current) => allSelected ? current.filter((id) => !categorySources.some((source) => source.sourceId === id)) : [...new Set([...current, ...categorySources.map((source) => source.sourceId)])])}>{allSelected ? "Clear category" : "Select category"}</Button></div>
                          {categorySources.map((source) => <label className="ai-permission-row" key={source.sourceId}>
                            <span>{source.label}</span><input className="themed-check" type="checkbox" checked={selectedSourceIds.includes(source.sourceId)} onChange={() => toggleSource(source.sourceId)} />
                          </label>)}
                        </details>;
                      })}
                    </div>
                  </>
                )}
                <Button className="ai-start-access" onClick={() => void startSession()} disabled={busy || (sourceScope === "selected" ? selectedSourceIds.length === 0 : eligibleSources.length === 0)}>
                  {busy ? "Starting…" : `Start access for ${sourceScope === "selected" ? selectedSourceIds.length : eligibleSources.length} source${(sourceScope === "selected" ? selectedSourceIds.length : eligibleSources.length) === 1 ? "" : "s"}`}
                </Button>
                <FormError>{sessionError}</FormError>
                {connection && <div className="ai-connection-details"><div className="ai-section-heading"><div><h4>Live Codex connection</h4><p>Copy this session ID and pairing secret into the local plugin. Use the MCP token you created above. Keep this page open.</p></div></div><div className="ai-connection-value"><span><small>Session ID</small><code>{connection.sessionId}</code></span><Button onClick={() => copyConnection("session", connection.sessionId)}>{copied === "session" ? "Copied" : "Copy"}</Button></div><div className="ai-connection-value"><span><small>Pairing secret</small><code>••••••••••••••••••••••••••••••••</code></span><Button onClick={() => copyConnection("secret", connection.secret)}>{copied === "secret" ? "Copied" : "Copy"}</Button></div></div>}
            </>
            {sessions.length > 0 && (
              <div className="ai-active-sessions">
                {sessions.map((session) => (
                  <div className="ai-active-session" key={session.grant.id}>
                    <span><strong>{session.workspace.name}</strong><small>{session.grant.readable.length} source{session.grant.readable.length === 1 ? "" : "s"} · expires {new Date(session.grant.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small></span>
                    <Button size="sm" className="danger" onClick={() => {
                      getContainer().aiAssistant.stopRelay(session.grant.id);
                      if (connection?.sessionId === session.grant.id) setConnection(null);
                      getContainer().aiAssistant.revokeSession(session.grant.id);
                      setSessions(getContainer().aiAssistant.listActiveSessions());
                      persistSessions();
                    }}>Revoke now</Button>
                  </div>
                ))}
                <Button size="sm" className="danger" onClick={revokeAll}>Disable all active AI access</Button>
              </div>
            )}
          </section>
        </>
      )}
    </section>
  );
}
