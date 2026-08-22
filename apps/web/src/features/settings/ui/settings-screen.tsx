"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSettings, UserIntegrationDescriptor } from "@weaveforge/core";
import {
  applyUserIntegrationFields,
  getUserIntegrationField,
  isUserIntegrationConnected,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "@/features/projects";
import { OrgPanel } from "@/features/org";
import { SyncSettings } from "@/features/sync";
import { SearchSettingsPanel } from "./search-settings-panel";
import { PasteSettingsPanel } from "./paste-settings-panel";
import { WorkspaceFolderPanel } from "./workspace-folder-panel";
import { AiProviderPanel } from "./ai-provider-panel";
import { AccountInfoPanel } from "./account-info-panel";
import { PrivacyNotice } from "./privacy-notice";
import { DeleteAccountPanel } from "./delete-account-panel";
import { ExportDataPanel } from "./export-data-panel";
import { ApiTokensPanel } from "./api-tokens-panel";
import { GitHubLinkCard } from "./github-link-card";
import { Select } from "@/components/select";
import { userIntegrationsForConfig } from "@/integrations/descriptors-resolve";
import { DARK_THEME_OPTIONS, LIGHT_THEME_OPTIONS, CONTROL_SIZE_OPTIONS, SURFACE_STYLE_OPTIONS, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, sanitizeThemeId, sanitizeControlSize, sanitizeSurfaceStyle, type ControlSizeId, type SurfaceStyle, type ThemeConfig } from "@/lib/theme/theme";
import { persistThemeChange, readLocalAppearance } from "@/lib/theme/theme-persistence";
import { AiAccessPanel } from "./ai-access-panel";
import { ThemeConfigPanel } from "./theme-config-panel";
import { DesktopUpdatePanel, useDesktopUpdate } from "./desktop-update-panel";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import { useSubmit } from "@/lib/hooks/use-submit";

/**
 * Settings sections, as tabs. This screen used to render all eight stacked
 * with a sticky jump nav on top; adding the appearance controls pushed it past
 * the point where the nav was doing enough, so only the selected section
 * renders now. Same `.seg` / `role="tablist"` idiom as the papers layout
 * switch, which is the app's one tab control.
 */
const SETTINGS_TABS = [
  { id: "account", label: "Account" },
  { id: "org", label: "Org" },
  { id: "appearance", label: "Appearance" },
  { id: "search", label: "Search" },
  { id: "paste", label: "Paste" },
  { id: "folder", label: "Folder" },
  { id: "ai", label: "AI" },
  { id: "tokens", label: "Tokens" },
  { id: "integrations", label: "Integrations" },
  { id: "sync", label: "Sync" },
  { id: "data", label: "Data" },
  { id: "updates", label: "Updates" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id));

/**
 * The jump nav's `#settings-appearance` anchors are already linked to from
 * elsewhere, so the hash keeps selecting the section — it just picks a tab now
 * instead of scrolling to it.
 */
function tabFromHash(hash: string): SettingsTabId | null {
  const id = hash.replace(/^#settings-/, "");
  return SETTINGS_TAB_IDS.has(id) ? (id as SettingsTabId) : null;
}

/**
 * Settings screen. Edits the per-user settings record (third-party keys).
 * User integrations are driven by the descriptor registry + deployment config.
 */
export function SettingsScreen() {
  const { current } = useProject();
  // Read after mount, not during render. The preload script runs before this
  // bundle, but the *server* render has no window at all — deciding there
  // would ship a tab that vanishes on hydration.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => setIsDesktop(desktop() !== null), []);
  const { update } = useDesktopUpdate();
  const integrationConfig = getContainer().integrationConfig;
  const userIntegrations = useMemo(
    () => userIntegrationsForConfig(integrationConfig),
    [integrationConfig],
  );

  const [settings, setSettings] = useState<UserSettings>({});
  const [loading, setLoading] = useState(true);
  const [, setSaved] = useState(false);
  const [collections, setCollections] = useState<{ key: string; name: string }[]>([]);
  /** State of the live credential probe shown inside the connection dialog. */
  const [collectionsProbe, setCollectionsProbe] = useState<
    "idle" | "loading" | "ready" | "empty" | "failed"
  >("idle");
  const [projectCollection, setProjectCollection] = useState<string>("");
  const [lightTheme, setLightTheme] = useState<string>(DEFAULT_LIGHT_THEME);
  const [darkTheme, setDarkTheme] = useState<string>(DEFAULT_DARK_THEME);
  const [controlSize, setControlSize] = useState<ControlSizeId>("default");
  const [surfaces, setSurfaces] = useState<SurfaceStyle>("borderless");
  const [reactiveMotion, setReactiveMotion] = useState(false);
  const [customTheme, setCustomTheme] = useState<ThemeConfig | null>(null);
  const [activeProvider, setActiveProvider] = useState<UserIntegrationDescriptor | null>(null);
  const [aiAccessOpen, setAiAccessOpen] = useState(false);
  const [tab, setTab] = useState<SettingsTabId>("account");

  // Hash is read once on mount rather than tracked: `selectTab` writes it with
  // replaceState, and reacting to a hash we just wrote would fight the click.
  useEffect(() => {
    const fromHash = tabFromHash(window.location.hash);
    if (fromHash) setTab(fromHash);
  }, []);

  function selectTab(next: SettingsTabId) {
    setTab(next);
    history.replaceState(null, "", `#settings-${next}`);
  }

  const { busy, error, setError, submit } = useSubmit(async () => {
    await getContainer().settings.manageSettings.save(settings);
    // Ranking is read per query, so this lands without a reindex.
    getContainer().search.setSettings(settings.search);
    setSaved(true);
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await getContainer().settings.manageSettings.get());
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    void load();
    const appearance = readLocalAppearance();
    setLightTheme(appearance.lightTheme ?? DEFAULT_LIGHT_THEME);
    setDarkTheme(appearance.darkTheme ?? DEFAULT_DARK_THEME);
    setControlSize(sanitizeControlSize(appearance.controlSize));
    setSurfaces(sanitizeSurfaceStyle(appearance.surfaces));
    setReactiveMotion(appearance.reactiveMotion ?? false);
    setCustomTheme(appearance.customTheme ?? null);
  }, [load]);

  function handleLightThemeChange(val: string) {
    const safe = sanitizeThemeId(val, "light");
    setLightTheme(safe);
    persistThemeChange(
      { lightTheme: safe },
      { apply: document.documentElement.dataset.mode !== "dark" },
    );
  }

  function handleDarkThemeChange(val: string) {
    const safe = sanitizeThemeId(val, "dark");
    setDarkTheme(safe);
    persistThemeChange(
      { darkTheme: safe },
      { apply: document.documentElement.dataset.mode === "dark" },
    );
  }

  function handleControlSizeChange(val: string) {
    const safe = sanitizeControlSize(val);
    setControlSize(safe);
    persistThemeChange({ controlSize: safe });
  }

  function handleSurfacesChange(val: string) {
    const safe = sanitizeSurfaceStyle(val);
    setSurfaces(safe);
    persistThemeChange({ surfaces: safe });
  }

  function handleReactiveMotionChange(on: boolean) {
    setReactiveMotion(on);
    persistThemeChange({ reactiveMotion: on });
  }

  function handleCustomThemeChange(config: ThemeConfig | null) {
    setCustomTheme(config);
    if (config) {
      // A theme file carries its own surface and motion preference, so the
      // controls above have to follow what was just applied.
      setSurfaces(config.surfaces);
      setReactiveMotion(config.reactiveMotion);
    }
  }

  const loadCollections = useCallback(async () => {
    if (integrationConfig.bibliography === "none") return;
    try {
      const facade = getContainer().settings;
      setCollections(await facade.listBibliographyCollections());
      if (current) setProjectCollection((await facade.getProjectCollection(current.id)) ?? "");
    } catch {
      /* bibliography not configured yet */
    }
  }, [current, integrationConfig.bibliography]);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

  // The credentials currently typed into the open connection dialog. Read as a
  // stable string so the effect below re-runs on an edit but not on unrelated
  // settings changes.
  const bibliographyProviderId =
    integrationConfig.bibliography !== "none" ? integrationConfig.bibliography : null;
  const typedBibliographyCredentials = useMemo(() => {
    if (!bibliographyProviderId || activeProvider?.providerId !== bibliographyProviderId) {
      return null;
    }
    const entries = activeProvider.fields.map(
      (field) =>
        [field.id, getUserIntegrationField(settings, bibliographyProviderId, field.id) ?? ""] as const,
    );
    if (entries.some(([, value]) => value.trim() === "")) return null;
    return Object.fromEntries(entries);
  }, [activeProvider, bibliographyProviderId, settings]);
  const credentialsKey = typedBibliographyCredentials
    ? JSON.stringify(typedBibliographyCredentials)
    : "";

  /**
   * Fill the collection picker from the credentials being typed.
   *
   * Previously this list came only from *saved* settings, so connecting Zotero
   * meant typing a key, saving, reopening the dialog, and only then choosing a
   * collection — the form said as much ("Save credentials, then reopen"). The
   * request is debounced because it goes to Zotero on every keystroke otherwise,
   * and a stale reply is dropped so a slow response for a half-typed key cannot
   * overwrite the list for the finished one.
   */
  // Reopening the dialog must not show the previous provider's verdict.
  useEffect(() => {
    setCollectionsProbe("idle");
  }, [activeProvider?.providerId]);

  useEffect(() => {
    if (!credentialsKey) return;
    let cancelled = false;
    setCollectionsProbe("loading");
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const found = await getContainer().settings.listBibliographyCollections(
            JSON.parse(credentialsKey) as Record<string, string>,
          );
          if (cancelled) return;
          setCollections(found);
          setCollectionsProbe(found.length > 0 ? "ready" : "empty");
        } catch {
          if (!cancelled) setCollectionsProbe("failed");
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [credentialsKey]);

  async function saveCollection(key: string) {
    setProjectCollection(key);
    if (current) await getContainer().settings.setProjectCollection(current.id, key || null);
  }

  function patchProviderField(providerId: string, fieldId: string, value: string) {
    setSettings((s) => applyUserIntegrationFields(s, providerId, { [fieldId]: value }));
    setSaved(false);
  }


  const showBibliographyCollection =
    activeProvider?.providerId === integrationConfig.bibliography &&
    integrationConfig.bibliography !== "none";

  const tabs = SETTINGS_TABS.filter((t) => {
    if (t.id === "integrations") return userIntegrations.length > 0;
    // A browser has no window to update. The tab is not disabled or empty for
    // one — it is not there, because a section that can never say anything is
    // a section a reader opens once and learns to distrust.
    if (t.id === "updates") return isDesktop;
    return true;
  });

  return (
    <section className="screen settings-screen">
      <div className="seg settings-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`settings-${t.id}`}
            className={tab === t.id ? "seg-on" : ""}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
            {/* The dot is the whole notice between sign-ins: something to
                notice, with nothing to answer. */}
            {t.id === "updates" && update && <span className="tab-dot" aria-label="update available" />}
          </button>
        ))}
      </div>

      {tab === "updates" && (
        <div id="settings-updates" className="settings-anchor" role="tabpanel" aria-labelledby="settings-tab-updates">
          <DesktopUpdatePanel />
        </div>
      )}

      {tab === "account" && <AccountInfoPanel />}

      {tab === "org" && (
        <div id="settings-org" className="settings-anchor" role="tabpanel" aria-labelledby="settings-tab-org">
          <OrgPanel />
        </div>
      )}

      {tab === "folder" && <WorkspaceFolderPanel />}

      {tab === "ai" && <AiProviderPanel />}

      {tab === "search" && (
        <SearchSettingsPanel
          value={settings.search}
          onChange={(search) => setSettings((prev) => ({ ...prev, search }))}
        />
      )}

      {/* Not part of `settings`: the paste rules are a per-device preference
          and save themselves, so this panel does not join the Save button's
          dirty state. */}
      {tab === "paste" && <PasteSettingsPanel />}

      {tab === "appearance" && (
      <div id="settings-appearance" className="card add-form settings-anchor" role="tabpanel" aria-labelledby="settings-tab-appearance">
        <h3 className="settings-group">Appearance</h3>
        <p className="muted" style={{ margin: "4px 0 12px" }}>Choose your preferred themes for light and dark modes.</p>
        <div className="field-row-equal">
          <div className="field">
            <label htmlFor="lightTheme">Light Theme</label>
            <Select id="lightTheme" value={lightTheme} onChange={(e) => handleLightThemeChange(e.target.value)}>
              {LIGHT_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div className="field">
            <label htmlFor="darkTheme">Dark Theme</label>
            <Select id="darkTheme" value={darkTheme} onChange={(e) => handleDarkThemeChange(e.target.value)}>
              {DARK_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="field" style={{ marginTop: "12px" }}>
          <label htmlFor="controlSize">Button size</label>
          <Select id="controlSize" value={controlSize} onChange={(e) => handleControlSizeChange(e.target.value)}>
            {CONTROL_SIZE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Scales icon buttons and expand toggles (lists, report sections, cards) together.
          </p>
        </div>
        <div className="field" style={{ marginTop: "12px" }}>
          <label htmlFor="surfaces">Surfaces</label>
          <Select id="surfaces" value={surfaces} onChange={(e) => handleSurfacesChange(e.target.value)}>
            {SURFACE_STYLE_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </Select>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Borderless separates panels with shadow and light. Bordered restores every
            hairline — pick it with the High Contrast theme, where a shadow carries far
            too little contrast to mark an edge.
          </p>
        </div>
        <div className="field" style={{ marginTop: "12px" }}>
          <label className="toggle-row" htmlFor="reactiveMotion">
            <input
              id="reactiveMotion"
              type="checkbox"
              className="themed-check"
              checked={reactiveMotion}
              onChange={(e) => handleReactiveMotionChange(e.target.checked)}
            />
            <span>Reactive animations</span>
          </label>
          <p className="muted" style={{ margin: "6px 0 0" }}>
            Cards tilt toward the pointer and catch a light sheen; buttons and nav icons
            respond to hover and press. Off by default. The app&rsquo;s existing
            transitions are unaffected either way, and a system &ldquo;reduce
            motion&rdquo; setting overrides this.
          </p>
        </div>
        <ThemeConfigPanel current={customTheme} onChange={handleCustomThemeChange} />
      </div>
      )}

      {tab === "ai" && loading && <ScreenLoader status="Loading settings…" compact />}
      {tab === "ai" && !loading && (
        <div id="settings-ai" className="card add-form settings-anchor" role="tabpanel" aria-labelledby="settings-tab-ai">
          <h3 className="settings-group">AI & MCP</h3>
          <p className="muted">Control what an AI client such as Codex may read or propose. Access is off by default.</p>
          <button type="button" className="integration-item ai-access-launcher" onClick={() => setAiAccessOpen(true)}>
            <span className="integration-logo ai-access-launcher-icon">✦</span>
            <div className="integration-main"><strong>AI assistant access</strong><span className="muted">Sources, proposals, active sessions, and revocation.</span></div>
            <span className={`status ${settings.aiAccess?.enabled ? "status-done" : "status-not_started"}`}>{settings.aiAccess?.enabled ? "Enabled" : "Disabled"}</span>
          </button>
        </div>
      )}

      {(tab === "tokens" || tab === "integrations") && loading && (
        <ScreenLoader status="Loading settings…" compact />
      )}

      {tab === "tokens" && !loading && <ApiTokensPanel />}

      {tab === "integrations" && !loading && (
        <>
          {userIntegrations.length > 0 ? (
            <div id="settings-integrations" className="card add-form settings-anchor" role="tabpanel" aria-labelledby="settings-tab-integrations">
              <h3 className="settings-group">Integrations</h3>
              <p className="muted">Metadata sources for your library. Tap one to configure it.</p>
              <div className="integration-list">
                {userIntegrations.map((d) => {
                  const connected = isUserIntegrationConnected(
                    settings,
                    d.providerId,
                    d.fields.map((f) => f.id),
                  );
                  return (
                    <button
                      key={d.providerId}
                      type="button"
                      className="integration-item"
                      onClick={() => setActiveProvider(d)}
                    >
                      <span className="integration-logo" style={{ background: d.color }} />
                      <div className="integration-main">
                        <strong>{d.title}</strong>
                        <span className="muted">{d.description}</span>
                      </div>
                      <span className={`status ${connected ? "status-done" : "status-not_started"}`}>
                        {connected ? "Connected" : "Not set"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </>
      )}

      {activeProvider && (
        <Modal title={activeProvider.title} onClose={() => setActiveProvider(null)}>
          <form
            className="add-form"
            onSubmit={(e) => { void submit(e).then(() => setActiveProvider(null)); }}
          >
            <p className="muted" style={{ marginTop: 0 }}>{activeProvider.description}</p>
            {activeProvider.fields.map((field) => (
              <div className="field" key={field.id}>
                <label htmlFor={`${activeProvider.providerId}-${field.id}`}>{field.label}</label>
                <input
                  id={`${activeProvider.providerId}-${field.id}`}
                  type={field.type}
                  value={getUserIntegrationField(settings, activeProvider.providerId, field.id) ?? ""}
                  onChange={(e) => patchProviderField(activeProvider.providerId, field.id, e.target.value)}
                  placeholder={field.placeholder}
                  autoComplete="off"
                />
              </div>
            ))}
            {showBibliographyCollection && current && (
              <div className="field">
                <label htmlFor="bib-col">Collection — {current.name}</label>
                <Select
                  id="bib-col"
                  value={projectCollection}
                  onChange={(e) => void saveCollection(e.target.value)}
                >
                  <option value="">— whole library —</option>
                  {collections.map((c) => (
                    <option key={c.key} value={c.key}>{c.name}</option>
                  ))}
                </Select>
                {/* The picker now reflects the credentials as they are typed, so
                    it can say what the library actually returned instead of
                    telling the user to save and come back. */}
                {collectionsProbe === "loading" && (
                  <span className="muted">Checking the library…</span>
                )}
                {collectionsProbe === "failed" && (
                  <span className="muted">
                    Could not read collections — check the API key and library.
                  </span>
                )}
                {collectionsProbe === "empty" && (
                  <span className="muted">This library has no collections.</span>
                )}
                {collectionsProbe === "idle" && collections.length === 0 && (
                  <span className="muted">
                    Enter {activeProvider.fields.map((f) => f.label.toLowerCase()).join(" and ")} to
                    list collections.
                  </span>
                )}
              </div>
            )}
            {error && <p className="error">{error}</p>}
            <button className="btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save connection"}
            </button>
          </form>
        </Modal>
      )}

      {aiAccessOpen && (
        <Modal title="AI & MCP access" onClose={() => !busy && setAiAccessOpen(false)}>
          <form className="add-form ai-access-modal" onSubmit={(event) => { void submit(event).then(() => setAiAccessOpen(false)); }}>
            <AiAccessPanel settings={settings} onChange={setSettings} />
            {error && <p className="error">{error}</p>}
            <div className="ai-access-modal-actions"><button type="button" className="btn-secondary" onClick={() => setAiAccessOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save AI access"}</button></div>
          </form>
        </Modal>
      )}

      {tab === "sync" &&
        (loading ? (
          <ScreenLoader status="Loading settings…" compact />
        ) : (
          <div id="settings-sync" className="settings-anchor" role="tabpanel" aria-labelledby="settings-tab-sync">
            <SyncSettings />
          </div>
        ))}

      {tab === "data" && (
        <div id="settings-data-panel" role="tabpanel" aria-labelledby="settings-tab-data">
          <ExportDataPanel />
          <PrivacyNotice />
          <GitHubLinkCard />
          <DeleteAccountPanel />
        </div>
      )}
    </section>
  );
}
