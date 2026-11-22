/**
 * Settings-backed repositories (0.9.7 L3): the per-user and per-project
 * preferences that were rows in the local database now live in
 * `.weaveforge/settings.json`. Laws in test/file-settings-repos.test.ts.
 *
 * Keys in the settings file:
 * - `dashboard.<project id>`: the dashboard layout, as saved.
 * - `graph.<project id>`: the graph view state, as saved.
 * - `quotationTypes.<paper id>.<annotation key>`: `{ type, createdAt, updatedAt }`.
 * - `integrations.zoteroCollection.<project id>`: the Zotero collection key.
 * - `integrationSettings`: the non-secret integration fields, per provider.
 * - `zoteroLibrary`, `disclaimer` (`{ acceptedAt, version }`), `appearance`,
 *   `aiAccess`, `search`, `releaseNoticeSeen`: the user settings.
 *
 * Integration secrets (`zoteroApiKey`, `semanticScholarKey`, and secret-named
 * fields inside `integrations`) never reach the file: they go through a
 * `SecretsStore` (the OS keychain).
 */
import {
  CURRENT_DISCLAIMER_VERSION,
  type AnnotationQuotationType,
  type DashboardLayout,
  type GraphPersistedState,
  type IAnnotationQuotationTypeRepository,
  type IDashboardLayoutRepository,
  type IGraphSettingsRepository,
  type IProjectBibliographyCollectionStore,
  type ISettingsRepository,
  type QuotationType,
  type SaveAnnotationQuotationTypeInput,
  type SettingsMetadata,
  type UserAppearance,
  type UserSettings,
} from "@weaveforge/core";
import type { Secrets, SecretsStore, SettingsWrites } from "@/features/settings/infrastructure/parts";
import { typedCore } from "@/lib/rust-core";
import type { SettingsSection } from "./file-tag-repo";
import { assertNoSecret, isSecretValueKey } from "./file-settings-section";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A copy, so a caller mutating what it saved or read cannot change the stored value. */
function clone<T>(v: T): T {
  return structuredClone(v);
}

type Integrations = Record<string, Record<string, string>>;

/** Secret-named fields go to the secrets store; the rest (e.g. a zotero library) go to the file. */
function splitIntegrations(all: Integrations): { secret: Integrations; plain: Integrations } {
  const secret: Integrations = {};
  const plain: Integrations = {};
  for (const [provider, fields] of Object.entries(all)) {
    for (const [name, value] of Object.entries(fields)) {
      const bag = isSecretValueKey(name) ? secret : plain;
      (bag[provider] ??= {})[name] = value;
    }
  }
  return { secret, plain };
}

/** Merges the file part and the secrets part per provider; undefined when neither holds anything. */
function mergeIntegrations(plain: Integrations | undefined, secret: Integrations | undefined): Integrations | undefined {
  if (!plain && !secret) return undefined;
  const out: Integrations = {};
  for (const source of [plain, secret]) {
    for (const [provider, fields] of Object.entries(source ?? {})) out[provider] = { ...out[provider], ...fields };
  }
  return out;
}

/**
 * One save over the stored fields, per provider and per field: undefined keeps the stored value, "" deletes
 * it, anything else sets it. A provider left with no fields is dropped.
 */
function applyFields(stored: Integrations | undefined, incoming: Integrations): Integrations {
  const out: Integrations = {};
  for (const [provider, fields] of Object.entries(stored ?? {})) out[provider] = { ...fields };
  for (const [provider, fields] of Object.entries(incoming)) {
    for (const [name, value] of Object.entries(fields)) {
      if (value === undefined) continue;
      if (value === "") {
        const bag = out[provider];
        if (bag) delete bag[name];
        continue;
      }
      (out[provider] ??= {})[name] = value;
    }
  }
  for (const provider of Object.keys(out)) {
    if (Object.keys(out[provider] ?? {}).length === 0) delete out[provider];
  }
  return out;
}

export class FileDashboardLayoutRepository implements IDashboardLayoutRepository {
  constructor(private readonly settings: SettingsSection) {}

  get(projectId: string): Promise<DashboardLayout | null> {
    const raw = this.settings.get(["dashboard", projectId]);
    return Promise.resolve(isObject(raw) ? clone(raw as unknown as DashboardLayout) : null);
  }

  save(projectId: string, layout: DashboardLayout): Promise<void> {
    return Promise.resolve(this.settings.set(["dashboard", projectId], clone(layout)));
  }
}

export class FileGraphSettingsRepository implements IGraphSettingsRepository {
  constructor(private readonly settings: SettingsSection) {}

  get(projectId: string): Promise<GraphPersistedState | null> {
    const raw = this.settings.get(["graph", projectId]);
    return Promise.resolve(isObject(raw) ? clone(raw as unknown as GraphPersistedState) : null);
  }

  save(projectId: string, state: GraphPersistedState): Promise<void> {
    return Promise.resolve(this.settings.set(["graph", projectId], clone(state)));
  }
}

const QUOTATION_TYPES: readonly QuotationType[] = ["direct", "paraphrase", "summary"];

export class FileQuotationTypeRepository implements IAnnotationQuotationTypeRepository {
  constructor(private readonly settings: SettingsSection) {}

  async save({ paperId, annotationKey, quotationType }: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    const now = new Date().toISOString();
    const stored = this.settings.get(["quotationTypes", paperId, annotationKey]);
    const createdAt = isObject(stored) && typeof stored.createdAt === "string" ? stored.createdAt : now;
    await this.settings.set(["quotationTypes", paperId, annotationKey], { type: quotationType, createdAt, updatedAt: now });
    return { id: `${paperId}:${annotationKey}`, paperId, annotationKey, quotationType, createdAt, updatedAt: now };
  }

  async remove(paperId: string, annotationKey: string): Promise<void> {
    if (this.settings.get(["quotationTypes", paperId, annotationKey]) !== undefined) {
      await this.settings.set(["quotationTypes", paperId, annotationKey], undefined);
    }
  }

  /** In file order; an entry with an unknown kind is skipped but kept. */
  listForPaper(paperId: string): Promise<AnnotationQuotationType[]> {
    const raw = this.settings.get(["quotationTypes", paperId]);
    if (!isObject(raw)) return Promise.resolve([]);
    const out: AnnotationQuotationType[] = [];
    for (const [annotationKey, entry] of Object.entries(raw)) {
      if (!isObject(entry) || !QUOTATION_TYPES.includes(entry.type as QuotationType)) continue;
      out.push({
        id: `${paperId}:${annotationKey}`,
        paperId,
        annotationKey,
        quotationType: entry.type as QuotationType,
        createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
        updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
      });
    }
    return Promise.resolve(out);
  }
}

export class FileBibliographyCollectionStore implements IProjectBibliographyCollectionStore {
  constructor(private readonly settings: SettingsSection) {}

  getCollection(projectId: string): Promise<string | undefined> {
    const raw = this.settings.get(["integrations", "zoteroCollection", projectId]);
    return Promise.resolve(typeof raw === "string" && raw ? raw : undefined);
  }

  setCollection(projectId: string, collectionKey: string | null): Promise<void> {
    return Promise.resolve(this.settings.set(["integrations", "zoteroCollection", projectId], collectionKey || undefined));
  }
}

/**
 * The user settings. Non-secret fields live in the settings file; the
 * credentials go through `secrets`, as `PostgrestSettingsRepository` does.
 */
export class FileSettingsRepository implements ISettingsRepository, SettingsWrites {
  constructor(
    private readonly settings: SettingsSection,
    private readonly secrets: SecretsStore,
  ) {}

  async get(): Promise<UserSettings> {
    // A failed read throws: shown as "no keys", the next save would wipe them.
    const secrets = await this.secrets.load();
    const s = this.settings;
    const ai = isObject(s.get(["aiAccess"])) ? typedCore().normalizeAiAccessSettings(s.get(["aiAccess"]) as never) : undefined;
    const search = s.get(["search"]);
    const hydrated = typedCore().hydrateUserSettings({
      zoteroApiKey: secrets.zoteroApiKey ?? undefined,
      zoteroLibrary: this.text(["zoteroLibrary"]),
      semanticScholarKey: secrets.semanticScholarKey ?? undefined,
      integrations: mergeIntegrations(this.plainIntegrations(), secrets.integrations ?? undefined),
      ...this.disclaimer(),
      appearance: this.appearance(),
      aiAccess: ai
        ? {
            enabled: ai.enabled,
            disclosureAcceptedAt: ai.disclosureAcceptedAt ?? undefined,
            readCategories: ai.readCategories,
            proposalKinds: ai.proposalKinds,
            autoIncludeNewSourceCategories: ai.autoIncludeNewSourceCategories ?? undefined,
          }
        : undefined,
    }) as UserSettings;
    return isObject(search) ? { ...hydrated, search: clone(search) as UserSettings["search"] } : hydrated;
  }

  /**
   * Writes the secrets when a secret field differs from the store. `undefined` keeps the stored value;
   * an empty string clears it. A save with no change never reaches the store, so a browser build with
   * no keychain does not refuse an unrelated settings save.
   */
  private async saveSecrets(settings: UserSettings, secret: Integrations): Promise<void> {
    const current: Secrets = await this.secrets.load();
    const merged = applyFields(current.integrations, secret);
    const next: Secrets = {
      zoteroApiKey: settings.zoteroApiKey !== undefined ? settings.zoteroApiKey || undefined : current.zoteroApiKey,
      semanticScholarKey:
        settings.semanticScholarKey !== undefined ? settings.semanticScholarKey || undefined : current.semanticScholarKey,
      integrations: settings.integrations === undefined ? current.integrations : Object.keys(merged).length > 0 ? merged : undefined,
    };
    const changed =
      next.zoteroApiKey !== current.zoteroApiKey ||
      next.semanticScholarKey !== current.semanticScholarKey ||
      JSON.stringify(next.integrations ?? null) !== JSON.stringify(current.integrations ?? null);
    if (changed) await this.secrets.save(next);
  }
  getMetadata(): Promise<SettingsMetadata> {
    const out: SettingsMetadata = { ...this.disclaimer() };
    const appearance = this.appearance();
    if (appearance) out.appearance = appearance;
    return Promise.resolve(out);
  }

  /**
   * Merges the given integration fields into the stored ones: a field set to "" is removed (disconnect),
   * a field left undefined keeps its stored value, and other providers are kept. Disclaimer, appearance,
   * AI access and search are replaced when given; an unset disclaimer, appearance or AI access keeps the stored one.
   */
  async save(settings: UserSettings): Promise<void> {
    const { secret, plain } = splitIntegrations(settings.integrations ?? {});
    const plainNext = applyFields(this.plainIntegrations(), plain);
    const plainValue = Object.keys(plainNext).length > 0 ? plainNext : undefined;
    // Every planned write is checked before the first one, so a refusal cannot leave a partial save.
    if (settings.integrations) assertNoSecret(["integrationSettings"], plainValue);
    await this.saveSecrets(settings, secret);
    const s = this.settings;
    // Awaited: each set resolves only once its write has reached settings.json.
    if (settings.integrations) await s.set(["integrationSettings"], plainValue);
    await s.set(["zoteroLibrary"], settings.zoteroLibrary || undefined);
    if (settings.disclaimerAcceptedAt !== undefined || settings.disclaimerVersion !== undefined) {
      await s.set(["disclaimer"], { acceptedAt: settings.disclaimerAcceptedAt, version: settings.disclaimerVersion });
    }
    if (settings.appearance) await s.set(["appearance"], clone(settings.appearance));
    if (settings.aiAccess) await s.set(["aiAccess"], clone(settings.aiAccess));
    if (settings.search) await s.set(["search"], clone(settings.search));
  }

  saveDisclaimer(acceptedAt: string, version: number): Promise<void> {
    return Promise.resolve(this.settings.set(["disclaimer"], { acceptedAt, version }));
  }

  acceptDisclaimer(): Promise<void> {
    return this.saveDisclaimer(new Date().toISOString(), CURRENT_DISCLAIMER_VERSION);
  }

  /** Merges over the stored appearance, then normalizes. */
  saveAppearance(appearance: UserAppearance): Promise<void> {
    const stored = this.settings.get(["appearance"]);
    const merged = { ...(isObject(stored) ? stored : {}), ...appearance };
    return Promise.resolve(this.settings.set(["appearance"], typedCore().normalizeAppearance(merged) ?? undefined));
  }

  saveNoticeSeen(version: string): Promise<void> {
    if (!version) return Promise.reject(new Error("A release notice version is required."));
    return Promise.resolve(this.settings.set(["releaseNoticeSeen"], version));
  }

  /** The release notice last dismissed, if any. */
  noticeSeen(): string | undefined {
    return this.text(["releaseNoticeSeen"]);
  }

  private plainIntegrations(): Integrations | undefined {
    const raw = this.settings.get(["integrationSettings"]);
    return isObject(raw) ? (clone(raw) as Integrations) : undefined;
  }

  private text(key: readonly string[]): string | undefined {
    const v = this.settings.get(key);
    return typeof v === "string" && v ? v : undefined;
  }

  private disclaimer(): Pick<UserSettings, "disclaimerAcceptedAt" | "disclaimerVersion"> {
    const d = this.settings.get(["disclaimer"]);
    if (!isObject(d)) return {};
    const out: Pick<UserSettings, "disclaimerAcceptedAt" | "disclaimerVersion"> = {};
    if (typeof d.acceptedAt === "string") out.disclaimerAcceptedAt = d.acceptedAt;
    if (typeof d.version === "number") out.disclaimerVersion = d.version;
    return out;
  }

  private appearance(): UserAppearance | undefined {
    const raw = this.settings.get(["appearance"]);
    return isObject(raw) ? ((typedCore().normalizeAppearance(raw) ?? undefined) as UserAppearance | undefined) : undefined;
  }
}
