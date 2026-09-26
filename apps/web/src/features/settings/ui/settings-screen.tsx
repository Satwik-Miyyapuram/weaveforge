"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { UserSettings, UserIntegrationDescriptor } from "@weaveforge/core";
import {
  applyUserIntegrationFields,
  getUserIntegrationField,
  isUserIntegrationConnected,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenHead } from "@/components/screen-head";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { useProject } from "@/features/projects";
import { OrgPanel } from "@/features/org";
import { SyncSettings } from "@/features/sync";
import { SearchSettingsPanel } from "./search-settings-panel";
import { PasteSettingsPanel } from "./paste-settings-panel";
import { EditorSettingsPanel } from "./editor-settings-panel";
import { WorkspaceFolderPanel } from "./workspace-folder-panel";
import { AiProviderPanel } from "./ai-provider-panel";
import { AccountInfoPanel } from "./account-info-panel";
import { PrivacyNotice } from "./privacy-notice";
import { DeleteAccountPanel } from "./delete-account-panel";
import { ExportDataPanel } from "./export-data-panel";
import { GitHubLinkCard } from "./github-link-card";
import { Select } from "@/components/select";
import { userIntegrationsForConfig } from "@/integrations/descriptors-resolve";
import { isOfflineBuild } from "@/deployment/build-target";
import { CARD_TINT_OPTIONS, isBrutalTheme, sanitizeCardTint, type CardTint, DARK_THEME_OPTIONS, LIGHT_THEME_OPTIONS, CONTROL_SIZE_OPTIONS, SURFACE_STYLE_OPTIONS, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, sanitizeThemeId, sanitizeControlSize, sanitizeSurfaceStyle, type ControlSizeId, type SurfaceStyle, type ThemeConfig } from "@/lib/theme/theme";
import { persistThemeChange, readLocalAppearance } from "@/lib/theme/theme-persistence";
import { AiAccessPanel } from "./ai-access-panel";
import { ThemeConfigPanel } from "./theme-config-panel";
import { OfflineStoragePanel, SyncIssuesPanel, SyncSettingsPanel } from "@/features/offline-sync";
import { DesktopUpdatePanel, useDesktopUpdate } from "./desktop-update-panel";
import { AppLogPanel } from "./app-log-panel";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { formatError } from "@/lib/format-error";
import { useSubmit } from "@/lib/hooks/use-submit";
import { useCapability, hasServerRoutes } from "@/deployment/capabilities";
import { FormError } from "@/components/form-error";

// Only the Tokens tab paints it, so it stays out of the route's first load.
const ApiTokensPanel = dynamic(() => import("./api-tokens-panel").then((m) => m.ApiTokensPanel), { ssr: false });

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
  { id: "editor", label: "Editor" },
  { id: "workspace", label: "Workspace" },
  { id: "ai", label: "AI" },
  { id: "tokens", label: "Tokens" },
  { id: "integrations", label: "Integrations" },
  { id: "sync", label: "Sync" },
  { id: "data", label: "Data" },
  { id: "updates", label: "Updates" },
] as const;

type SettingsTabId = (typeof SETTINGS_TABS)[number]["id"];

/**
 * The tabs, gathered into the six groups the side rail lists. Choosing a group
 * opens its first tab; the group's other tabs sit under it while it is open.
 */
const SETTINGS_GROUPS: readonly {
  id: string;
  label: string;
  hint: string;
  icon: keyof typeof GROUP_ICONS;
  tabs: readonly SettingsTabId[];
}[] = [
  { id: "account", label: "Account and lab", hint: "Profile, password, lab", icon: "person", tabs: ["account", "org", "tokens"] },
  { id: "appearance", label: "Appearance", hint: "Theme, tint, text", icon: "palette", tabs: ["appearance"] },
  { id: "editor", label: "Editor and writing", hint: "Editor, paste, workspace", icon: "pen", tabs: ["editor", "paste", "workspace"] },
  { id: "ai", label: "Search and AI", hint: "Search, models, API keys", icon: "search", tabs: ["search", "ai"] },
  { id: "sync", label: "Sync and integrations", hint: "Cloud, Zotero, Overleaf", icon: "sync", tabs: ["sync", "integrations"] },
  { id: "data", label: "Data and updates", hint: "Backups, export, version", icon: "data", tabs: ["data", "updates"] },
];

const GROUP_ICONS = {
  person: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" /></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18c1.4 0 2-1 1.5-2.1-.6-1.2.2-2.4 1.5-2.4H18a3 3 0 0 0 3-3A8.5 8.5 0 0 0 12 3Z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10" cy="7" r="1" /><circle cx="14.5" cy="7" r="1" /></>,
  pen: <><path d="M4 20l1-4L16 5l3 3L8 19l-4 1Z" /><path d="M14 7l3 3" /></>,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /><path d="M11 8v6M8 11h6" /></>,
  sync: <><path d="M4 12a8 8 0 0 1 13.7-5.6L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15" /><path d="M4 20v-5h5" /></>,
  data: <><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" /><path d="M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3" /></>,
} as const;

const SETTINGS_TAB_IDS = new Set<string>(SETTINGS_TABS.map((t) => t.id));

/**
 * The jump nav's `#settings-appearance` anchors are already linked to from
 * elsewhere, so the hash keeps selecting the section — it just picks a tab now
 * instead of scrolling to it.
 *
 * `#settings-folder` is aliased to the workspace tab. The tab was called
 * "Folder" until it took on the database as well — the two are one location
 * now — and a link written against the old name should land on the settings it
 * means rather than on nothing.
 */
function tabFromHash(hash: string): SettingsTabId | null {
  const id = hash.replace(/^#settings-/, "");
  if (id === "folder") return "workspace";
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
  // Same rule as the Updates tab below, applied to the sections that need an
  // account rather than a window: absent, not present and refusing.
  const hasAccount = useCapability("account");
  const hasOrgs = useCapability("org");
  const hasSync = useCapability("sync");
  const hasApiTokens = useCapability("apiTokens");
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
  const [cardTint, setCardTint] = useState<CardTint>("full");
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
    // The ink engine is probed once per session and kept. Saving settings can
    // change what the *desktop shell* answers — the local API's switch is the
    // one — so the probe is dropped here rather than being trusted forever.
    getContainer().ink.reset();
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
    setCardTint(sanitizeCardTint(appearance.cardTint));
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

  function handleCardTintChange(val: string) {
    const safe = sanitizeCardTint(val);
    setCardTint(safe);
    persistThemeChange({ cardTint: safe });
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
    // Nothing behind these without an account: no lab to administer, no server
    // to issue a token, no second device to reconcile with.
    if (t.id === "org") return hasOrgs;
    if (t.id === "tokens") return hasApiTokens;
    if (t.id === "sync") return hasSync;
    return true;
  });

  const visible = new Set<SettingsTabId>(tabs.map((t) => t.id));
  const labelOf = new Map<SettingsTabId, string>(tabs.map((t) => [t.id, t.label]));
  const groups = SETTINGS_GROUPS
    .map((g) => ({ ...g, tabs: g.tabs.filter((id) => visible.has(id)) }))
    .filter((g) => g.tabs.length > 0);

  return (
    <section className="screen settings-screen">
      <ScreenHead
        title="Settings"
        eyebrow={hasAccount ? "Saved on this device and synced to your account" : "Saved on this device"}
      />
      <div className="settings-layout">
      <nav className="settings-rail" aria-label="Settings sections">
        {groups.map((g) => {
          const open = g.tabs.includes(tab);
          return (
            <div key={g.id} className={`settings-rail-group${open ? " is-open" : ""}`}>
              <button
                type="button"
                className="settings-rail-head"
                aria-current={open ? "true" : undefined}
                onClick={() => { if (!open) selectTab(g.tabs[0]!); }}
              >
                <span className="settings-rail-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {GROUP_ICONS[g.icon]}
                  </svg>
                </span>
                <span className="settings-rail-text">
                  <span className="settings-rail-label">
                    {g.label}
                    {/* The dot is the whole notice between sign-ins: something to
                        notice, with nothing to answer. */}
                    {g.tabs.includes("updates") && update && <span className="tab-dot" aria-label="update available" />}
                  </span>
                  <span className="settings-rail-hint">{g.hint}</span>
                </span>
              </button>
              {open && g.tabs.length > 1 && (
                <div className="settings-rail-tabs" role="tablist" aria-label={g.label}>
                  {g.tabs.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`settings-tab-${id}`}
                      aria-selected={tab === id}
                      aria-controls={`settings-${id}`}
                      className={tab === id ? "is-active" : ""}
                      onClick={() => selectTab(id)}
                    >
                      {labelOf.get(id)}
                      {id === "updates" && update && <span className="tab-dot" aria-label="update available" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="settings-body">

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

      {tab === "workspace" && <WorkspaceFolderPanel />}

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
      {tab === "editor" && <EditorSettingsPanel />}

      {/* Laid out like a record page (styles/appearance.css): mono section
          heads over a hairline, one row per preference with its explanation on
          the left and the control on the right, and no box around any of it. */}
      {tab === "appearance" && (
      <div id="settings-appearance" className="settings-anchor appearance" role="tabpanel" aria-labelledby="settings-tab-appearance">
        <header className="appearance-head">
          <h3 className="appearance-title">Appearance</h3>
          <p className="appearance-lede">How WeaveForge looks on this device.</p>
        </header>

        <section className="appearance-section" aria-labelledby="appearance-theme-head">
          <h4 id="appearance-theme-head" className="record-section-head">Theme</h4>
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="lightTheme">Light theme</label>
              <p>Used while your system is in light mode.</p>
            </div>
            <Select id="lightTheme" value={lightTheme} onChange={(e) => handleLightThemeChange(e.target.value)}>
              {LIGHT_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="darkTheme">Dark theme</label>
              <p>Used while your system is in dark mode.</p>
            </div>
            <Select id="darkTheme" value={darkTheme} onChange={(e) => handleDarkThemeChange(e.target.value)}>
              {DARK_THEME_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          {(isBrutalTheme(lightTheme) || isBrutalTheme(darkTheme)) && (
            <div className="appearance-row appearance-row--stack">
              <div className="appearance-row-text">
                <span className="appearance-label" id="cardTint">Card tint</span>
                <p>How Poster and CRT colour a paper card by its reading status.</p>
              </div>
              <span />
              <div className="tint-picker" role="radiogroup" aria-labelledby="cardTint">
                {CARD_TINT_OPTIONS.map((opt) => (
                  <label key={opt.id} className={`tint-option tint-option--${opt.id}${cardTint === opt.id ? " is-on" : ""}`}>
                    <span className="tint-sample" aria-hidden>
                      <span className="tint-sample-card">
                        <strong>Locating and editing factual associations</strong>
                        <span className="tint-sample-meta">Meng et al. · 2022</span>
                        {opt.id === "none" && <span className="tint-sample-chip">Reading</span>}
                      </span>
                    </span>
                    <span className="tint-option-foot">
                      <input
                        type="radio"
                        name="cardTint"
                        value={opt.id}
                        checked={cardTint === opt.id}
                        onChange={() => handleCardTintChange(opt.id)}
                      />
                      <span>{opt.label}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <ThemeConfigPanel current={customTheme} onChange={handleCustomThemeChange} />
        </section>

        <section className="appearance-section" aria-labelledby="appearance-interface-head">
          <h4 id="appearance-interface-head" className="record-section-head">Interface</h4>
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="surfaces">Surfaces</label>
              <p>
                Borderless separates panels and cards with shadow and a faint fill; Bordered
                outlines each with a hairline. Pick Bordered with High Contrast, where a
                shadow carries too little contrast to mark an edge.
              </p>
            </div>
            <Select id="surfaces" value={surfaces} onChange={(e) => handleSurfacesChange(e.target.value)}>
              {SURFACE_STYLE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="controlSize">Button size</label>
              <p>Scales icon buttons and expand toggles (lists, report sections, cards) together.</p>
            </div>
            <Select id="controlSize" value={controlSize} onChange={(e) => handleControlSizeChange(e.target.value)}>
              {CONTROL_SIZE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </Select>
          </div>
          <div className="appearance-row">
            <div className="appearance-row-text">
              <label htmlFor="reactiveMotion">Reactive animations</label>
              <p>
                Cards tilt toward the pointer and catch a light sheen; buttons and nav icons
                respond to hover and press. Ordinary transitions are unaffected, and a
                system &ldquo;reduce motion&rdquo; setting overrides this.
              </p>
            </div>
            <input
              id="reactiveMotion"
              type="checkbox"
              role="switch"
              className="themed-check appearance-switch"
              checked={reactiveMotion}
              onChange={(e) => handleReactiveMotionChange(e.target.checked)}
            />
          </div>
        </section>
      </div>
      )}

      {tab === "ai" && loading && <ScreenLoader status="Loading settings…" compact />}
      {/* The MCP half only. The provider panel below it is a client-side BYOK
          setting and works with no server; the MCP relay and its tokens are both
          served by routes a static export does not contain. See
          `deployment/capabilities.ts` and `ai-access-panel.tsx`. */}
      {tab === "ai" && !loading && hasServerRoutes() && (
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
              {isOfflineBuild() ? (
                // The desktop bundle has no `/api/settings/credentials` to seal
                // them behind, so they go in this machine's database instead —
                // signed in or not. Saying so is the whole point: a reader who
                // has just signed in would otherwise reasonably assume the key
                // went to their account, and it did not. See `DeviceSecretsStore`.
                <p className="muted">
                  Keys are kept on this computer, in the app&rsquo;s own folder, protected by its file
                  permissions. Signing in does not move them to your account.
                </p>
              ) : null}
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
            {error && <FormError>{error}</FormError>}
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
            {error && <FormError>{error}</FormError>}
            <div className="ai-access-modal-actions"><button type="button" className="btn-secondary btn-cancel" onClick={() => setAiAccessOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy ? "Saving…" : "Save AI access"}</button></div>
          </form>
        </Modal>
      )}

      {tab === "sync" &&
        (loading ? (
          <ScreenLoader status="Loading settings…" compact />
        ) : (
          <div id="settings-sync" className="settings-anchor" role="tabpanel" aria-labelledby="settings-tab-sync">
            <SyncSettingsPanel />
          <SyncIssuesPanel />
          <OfflineStoragePanel />
            <SyncSettings />
          </div>
        ))}

      {tab === "data" && (
        <div id="settings-data-panel" role="tabpanel" aria-labelledby="settings-tab-data">
          {/* Exporting works either way — it reads the database this copy has. */}
          <ExportDataPanel />
          {/* The record of what went wrong, beside the data it is about. It is
              here rather than in its own tab on purpose: a reader opens this
              *after* something failed, and a panel they have to go looking for
              is one they will not find while stuck. */}
          <AppLogPanel />
          <PrivacyNotice />
          {/* Linking a provider and deleting an account both need the account. */}
          {hasAccount && <GitHubLinkCard />}
          {hasAccount && <DeleteAccountPanel />}
        </div>
      )}
      </div>
      </div>
    </section>
  );
}
