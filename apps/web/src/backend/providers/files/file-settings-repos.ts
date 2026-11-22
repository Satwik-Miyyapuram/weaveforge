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
 * - `zoteroLibrary`, `disclaimer` (`{ acceptedAt, version }`), `appearance`,
 *   `aiAccess`, `search`, `releaseNoticeSeen`: the user settings.
 *
 * Integration secrets (`zoteroApiKey`, `semanticScholarKey`, `integrations`)
 * never reach the file: they go through a `SecretsStore` (the OS keychain).
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
import type { SecretsStore, SettingsWrites } from "@/features/settings/infrastructure/parts";
import { typedCore } from "@/lib/rust-core";
import type { SettingsSection } from "./file-tag-repo";

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** A copy, so a caller mutating what it saved or read cannot change the stored value. */
function clone<T>(v: T): T {
  return structuredClone(v);
}

export class FileDashboardLayoutRepository implements IDashboardLayoutRepository {
  constructor(private readonly settings: SettingsSection) {}

  get(projectId: string): Promise<DashboardLayout | null> {
    const raw = this.settings.get(["dashboard", projectId]);
    return Promise.resolve(isObject(raw) ? clone(raw as unknown as DashboardLayout) : null);
  }

  save(projectId: string, layout: DashboardLayout): Promise<void> {
    this.settings.set(["dashboard", projectId], clone(layout));
    return Promise.resolve();
  }
}

export class FileGraphSettingsRepository implements IGraphSettingsRepository {
  constructor(private readonly settings: SettingsSection) {}

  get(projectId: string): Promise<GraphPersistedState | null> {
    const raw = this.settings.get(["graph", projectId]);
    return Promise.resolve(isObject(raw) ? clone(raw as unknown as GraphPersistedState) : null);
  }

  save(projectId: string, state: GraphPersistedState): Promise<void> {
    this.settings.set(["graph", projectId], clone(state));
    return Promise.resolve();
  }
}

const QUOTATION_TYPES: readonly QuotationType[] = ["direct", "paraphrase", "summary"];

export class FileQuotationTypeRepository implements IAnnotationQuotationTypeRepository {
  constructor(private readonly settings: SettingsSection) {}

  save({ paperId, annotationKey, quotationType }: SaveAnnotationQuotationTypeInput): Promise<AnnotationQuotationType> {
    const now = new Date().toISOString();
    const stored = this.settings.get(["quotationTypes", paperId, annotationKey]);
    const createdAt = isObject(stored) && typeof stored.createdAt === "string" ? stored.createdAt : now;
    this.settings.set(["quotationTypes", paperId, annotationKey], { type: quotationType, createdAt, updatedAt: now });
    return Promise.resolve({ id: `${paperId}:${annotationKey}`, paperId, annotationKey, quotationType, createdAt, updatedAt: now });
  }

  remove(paperId: string, annotationKey: string): Promise<void> {
    if (this.settings.get(["quotationTypes", paperId, annotationKey]) !== undefined) {
      this.settings.set(["quotationTypes", paperId, annotationKey], undefined);
    }
    return Promise.resolve();
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
    this.settings.set(["integrations", "zoteroCollection", projectId], collectionKey || undefined);
    return Promise.resolve();
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
      integrations: secrets.integrations ?? undefined,
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

  getMetadata(): Promise<SettingsMetadata> {
    const out: SettingsMetadata = { ...this.disclaimer() };
    const appearance = this.appearance();
    if (appearance) out.appearance = appearance;
    return Promise.resolve(out);
  }

  /** Full replace of the given fields; an unset disclaimer, appearance or AI access keeps the stored one. */
  async save(settings: UserSettings): Promise<void> {
    await this.secrets.save({
      zoteroApiKey: settings.zoteroApiKey,
      semanticScholarKey: settings.semanticScholarKey,
      integrations: settings.integrations,
    });
    const s = this.settings;
    s.set(["zoteroLibrary"], settings.zoteroLibrary || undefined);
    if (settings.disclaimerAcceptedAt !== undefined || settings.disclaimerVersion !== undefined) {
      s.set(["disclaimer"], { acceptedAt: settings.disclaimerAcceptedAt, version: settings.disclaimerVersion });
    }
    if (settings.appearance) s.set(["appearance"], clone(settings.appearance));
    if (settings.aiAccess) s.set(["aiAccess"], clone(settings.aiAccess));
    if (settings.search) s.set(["search"], clone(settings.search));
  }

  saveDisclaimer(acceptedAt: string, version: number): Promise<void> {
    this.settings.set(["disclaimer"], { acceptedAt, version });
    return Promise.resolve();
  }

  acceptDisclaimer(): Promise<void> {
    return this.saveDisclaimer(new Date().toISOString(), CURRENT_DISCLAIMER_VERSION);
  }

  /** Merges over the stored appearance, then normalizes. */
  saveAppearance(appearance: UserAppearance): Promise<void> {
    const stored = this.settings.get(["appearance"]);
    const merged = { ...(isObject(stored) ? stored : {}), ...appearance };
    this.settings.set(["appearance"], typedCore().normalizeAppearance(merged) ?? undefined);
    return Promise.resolve();
  }

  saveNoticeSeen(version: string): Promise<void> {
    if (!version) return Promise.reject(new Error("A release notice version is required."));
    this.settings.set(["releaseNoticeSeen"], version);
    return Promise.resolve();
  }

  /** The release notice last dismissed, if any. */
  noticeSeen(): string | undefined {
    return this.text(["releaseNoticeSeen"]);
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
