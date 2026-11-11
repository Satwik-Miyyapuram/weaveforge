import { LibraryTidyFacade } from "@/container/facades/library-tidy";
import type { IAuthService } from "@/features/auth/domain/auth";
import { MergePapersUseCase } from "@/features/papers/application/merge-papers.use-case";
import { queuePaperPdfDownload } from "@/features/reader/application/download-library-pdfs";
import { BucketAssetStore } from "@/lib/bucket-asset-store";
import { openAppDb, REFERENCE_STORE } from "@/lib/cache/app-idb";
import { invalidateAllRepoCaches } from "@/lib/cache/project-lww-invalidator";
import { logToApp } from "@/lib/error-report/app-log";
import { describeRejection, responseError } from "@/lib/format-error";
import { relayUrl } from "@/lib/parts";
import { loadCore } from "@/lib/rust-core";
import {
  type AddPaperDeps,
  AddPaperUseCase,
  type IAccountProvisioner,
  type IAdminUserProvisioner,
  type IBlobFetcher,
  type ICurrentUserProvider,
  type IMetadataSource,
  type IPaperRepository,
  type IShareLinkTokenHasher,
  type Member,
  type MetadataResolver,
  type NewMemberInput,
  type NewPaperInput,
  type Paper,
  paperInputWithoutNulls,
  type PaperMetadata,
  type PaperRef,
  type UpdatePaperUseCase,
} from "@weaveforge/core";
import type { OpenAlexWork } from "@weaveforge/wasm";
import { type BackendConfig, readBackendConfig } from "../backend/config";
import { localFirstParts } from "../backend/providers/local/local-first";
import { localFirstActive } from "../backend/providers/local/local-first-marker";
import { isLocalMode } from "../backend/providers/local/local-identity";
import { localBackendParts } from "../backend/providers/local/parts";
import {
  type WiredPostgrestBackend,
  wirePostgrestBackend,
} from "../backend/providers/postgrest/wire-postgrest-backend";
import { SupabaseAdminUserProvisioner } from "../backend/providers/supabase-auth/admin-provisioner";
import type { InkChunkStore } from "../features/ink/application/ink-chunk-store";
import type {
  ReferenceLookupCache,
  ResolvedReference,
} from "../features/reader/application/reference-lookup";
import type { IVaultAssetStore } from "../features/vault/domain/vault-assets";

// --- http-account-provisioner ---
/**
 * Provisions accounts by POSTing to our own privileged server route
 * (/api/admin/create-user), which holds the Supabase service-role key. The
 * caller's access token authenticates the request so the server can re-check
 * permissions. This is the only adapter that talks to that route.
 */
export class HttpAccountProvisioner implements IAccountProvisioner {
  constructor(
    private readonly auth: Pick<IAuthService, "getAccessToken">,
    private readonly endpoint = relayUrl("/api/admin/create-user"),
  ) {}

  async createMember(input: NewMemberInput): Promise<Member> {
    const token = await this.auth.getAccessToken();
    if (!token) throw new Error("You must be signed in to create accounts.");
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    });
    const payload = (await res.json().catch(() => ({}))) as {
      member?: Member;
      error?: string;
    };
    if (!res.ok || !payload.member) {
      throw responseError(res, payload.error, res.ok ? "Account created but no member returned." : "Failed to create account.");
    }
    // The team and lab lists are memoized; the new member must show at once.
    invalidateAllRepoCaches();
    return payload.member;
  }
}

// --- library-tidy ---
type MergeDeps = ConstructorParameters<typeof MergePapersUseCase>[0];

/**
 * The library tidy-up, wired.
 *
 * A piece of the composition root pulled out for the same reason as
 * `lifecycle.ts`: the root sits at the size cap, and a merge touches every
 * store that can point at a paper, which is a list worth reading in one place.
 */
export function createLibraryTidy(deps: {
  papers: IPaperRepository;
  updatePaper: UpdatePaperUseCase;
  resolver: Pick<MetadataResolver, "resolve">;
  newId: () => string;
  bibliography: MergeDeps["bibliography"];
  backend: {
    readerAnnotationRepository: MergeDeps["annotations"];
    annotationPinRepository: MergeDeps["pins"];
    annotationQuotationTypeRepository: MergeDeps["quotationTypes"];
    readingListItemRepository: MergeDeps["listItems"];
    paperFieldRepository: MergeDeps["fields"];
    paperRelationRepository: MergeDeps["relations"];
  };
}): LibraryTidyFacade {
  const { backend } = deps;
  return new LibraryTidyFacade({
    papers: deps.papers,
    updatePaper: deps.updatePaper,
    resolver: deps.resolver,
    mergePapers: new MergePapersUseCase({
      papers: deps.papers,
      annotations: backend.readerAnnotationRepository,
      pins: backend.annotationPinRepository,
      quotationTypes: backend.annotationQuotationTypeRepository,
      listItems: backend.readingListItemRepository,
      fields: backend.paperFieldRepository,
      relations: backend.paperRelationRepository,
      bibliography: deps.bibliography,
      newId: deps.newId,
    }),
  });
}

// --- openalex-metadata-source ---
export class OpenAlexMetadataSource implements IMetadataSource {
  readonly id = "openalex";
  constructor(
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
    private readonly baseUrl = "https://api.openalex.org/works",
    private readonly mailto?: string,
    /** The user's OpenAlex key, read per call: it is only decryptable after unlock. */
    private readonly apiKey?: () => Promise<string | undefined>,
  ) {}

  supports(ref: PaperRef): boolean { return ref.kind === "bibliographic"; }

  async fetch(ref: PaperRef): Promise<PaperMetadata> {
    if (ref.kind !== "bibliographic") throw new Error("Expected a bibliographic reference");
    const params = new URLSearchParams({ search: ref.hints?.title ?? ref.value, "per-page": "3" });
    if (this.mailto) params.set("mailto", this.mailto);
    const key = await this.apiKey?.();
    if (key) params.set("api_key", key);
    const response = await this.fetchFn(`${this.baseUrl}?${params}`);
    if (!response.ok) throw new Error(`OpenAlex metadata failed: ${response.status}`);
    const body = await response.json() as { results?: OpenAlexWork[] };
    const core = await loadCore();
    for (const work of body.results ?? []) {
      if (!work.title || !core.isBibliographicMatch(ref.hints ?? {}, { title: work.title, year: work.publication_year ?? undefined })) continue;
      return paperInputWithoutNulls(core.openAlexToMetadata(work));
    }
    throw new Error("No sufficiently similar OpenAlex match");
  }
}

// --- prefetch-paper-pdf.use-case ---
/**
 * Adding a paper, with its PDF fetched in the background once there is a
 * folder to put it in.
 *
 * The bulk walk (`downloadLibraryPdfs`) runs when a folder is adopted, so a
 * paper added *afterwards* — a local Zotero pull, a DOI resolved from the add
 * form, a duplicate shared into the library — would otherwise wait for the
 * next adoption to reach `papers/pdf/`. Every one of those paths creates its
 * paper through {@link AddPaperUseCase}, so decorating it here covers them
 * all, including the ones added by integrations that never see the papers
 * screen.
 *
 * A subclass rather than a wrapper because the use-case is injected as its own
 * class in a dozen places — and a subclass *is* one, which a hand-rolled
 * wrapper over a class with private fields would not be.
 */
/** How a paper's PDF is asked for; injected so a test needs no container. */
export type PaperPdfPrefetcher = (paperId: string) => void;

export class PrefetchingAddPaperUseCase extends AddPaperUseCase {
  constructor(
    deps: AddPaperDeps,
    private readonly prefetch: PaperPdfPrefetcher = queuePaperPdfDownload,
  ) {
    super(deps);
  }

  /**
   * The paper, and then its PDF — never the other way round.
   *
   * `addManual` answers with an existing paper when the input is a duplicate,
   * and asking for that paper's PDF again is free: the store is checked first
   * and, where it already holds the bytes, nothing is fetched.
   */
  override async addManual(input: NewPaperInput): Promise<Paper> {
    const paper = await super.addManual(input);
    try {
      this.prefetch(paper.id);
    } catch {
      // The paper exists, which is what was asked for. A prefetch that cannot
      // even be queued is not a reason to fail the add: the reader resolves
      // the paper's source when it is opened, folder or no folder.
    }
    return paper;
  }
}

// --- reference-lookup-cache ---
/**
 * IndexedDB backing for `ReferenceLookupService`: a resolved bibliography entry
 * survives a reload, so reopening a paper paints "in library" and Scholar-like
 * records without a second round of Crossref and Semantic Scholar calls.
 *
 * Every operation is best-effort. A profile with no IndexedDB (private window,
 * quota exhausted) degrades to the service's in-memory map — slower, never
 * broken.
 */
export class IdbReferenceLookupCache implements ReferenceLookupCache {
  async get(key: string): Promise<ResolvedReference | undefined> {
    if (typeof indexedDB === "undefined") return undefined;
    try {
      const db = await openAppDb();
      return await new Promise<ResolvedReference | undefined>((resolve, reject) => {
        const tx = db.transaction(REFERENCE_STORE, "readonly");
        const req = tx.objectStore(REFERENCE_STORE).get(key);
        req.onsuccess = () => resolve((req.result as ResolvedReference | undefined) ?? undefined);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: ResolvedReference): Promise<void> {
    if (typeof indexedDB === "undefined" || value.status === "pending") return;
    try {
      const db = await openAppDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(REFERENCE_STORE, "readwrite");
        // `inLibrary` is a live fact about this workspace, not about the
        // reference; it is re-checked on read, so only the metadata is kept.
        const stored: ResolvedReference = value.status === "resolved" ? { ...value, inLibrary: undefined } : value;
        tx.objectStore(REFERENCE_STORE).put(stored, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* best-effort */
    }
  }
}

// --- report-citation-alert-error ---
/** Logs a citation alert check or notification that failed for one paper. */
export function reportCitationAlertError(paperId: string, error: unknown): void {
  logToApp({
    level: "warn",
    source: "citation-alerts",
    message: "A citation alert check or notification failed",
    detail: `${paperId}: ${describeRejection(error)}`,
  });
}

// --- routed-ink-chunk-store ---
/**
 * The store the app hands the host: the folder while one is open, the bucket
 * otherwise, decided per call rather than per session because a folder can be
 * opened or closed while a note is on screen.
 *
 * `ready` holds every call until the remembered folder has been taken back up
 * at launch. Without it a note opened straight away was read from the bucket,
 * found nothing there, and showed its pages empty until it was opened again.
 *
 * One home per stroke set, and it is whichever store the call picks. A page
 * drawn with a folder open is written to the folder and is not also written to
 * the bucket, so two devices' pages meet where their homes meet -- a folder
 * both machines can see, or one account's bucket. They do not meet by
 * themselves across a folder and a bucket, which is the one thing about
 * overlapping handwriting that a reader can be surprised by: the note's text
 * merges across devices, its strokes stay where they were drawn.
 */
export class RoutedInkChunkStore implements InkChunkStore {
  constructor(
    private readonly pick: () => InkChunkStore,
    private readonly ready: () => Promise<void> = () => Promise.resolve(),
  ) {}

  private async store() {
    await this.ready();
    return this.pick();
  }

  async read(noteId: string, chunkId: string) {
    return (await this.store()).read(noteId, chunkId);
  }
  async write(noteId: string, chunkId: string, bytes: Uint8Array) {
    return (await this.store()).write(noteId, chunkId, bytes);
  }
  async remove(noteId: string, chunkId: string) {
    return (await this.store()).remove(noteId, chunkId);
  }
  async list(noteId: string) {
    return (await this.store()).list(noteId);
  }
}

// --- vault-asset-store ---
/** Private vault image storage — `{userId}/{pageId}/{uuid}.{ext}`. */
export class VaultAssetStore extends BucketAssetStore implements IVaultAssetStore {
  constructor(blobs: IBlobFetcher, session: ICurrentUserProvider) {
    super("vault-assets", blobs, session);
  }
}

// --- web-crypto-token-hasher ---
export class WebCryptoShareLinkTokenHasher implements IShareLinkTokenHasher {
  async hash(token: Uint8Array): Promise<Uint8Array> {
    const bytes = new Uint8Array(token);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return new Uint8Array(digest);
  }
}

// --- wire-backend ---
export type WiredBackend = WiredPostgrestBackend;

export function wireBackend(
  config: BackendConfig = readBackendConfig(),
  projectContext = { projectId: null as string | null },
  pid: () => string | null = () => projectContext.projectId,
): WiredBackend {
  // Working on this computer is not a different set of repositories, only a
  // different database, identity and blob store handed to the same ones.
  if (isLocalMode()) return wirePostgrestBackend(config, projectContext, pid, localBackendParts());
  // A signed-in desktop that has its account's data on disk works on that copy.
  const account = localFirstActive();
  if (account) return wirePostgrestBackend(config, projectContext, pid, localFirstParts(config, account));

  switch (config.provider) {
    case "postgrest":
      return wirePostgrestBackend(config, projectContext, pid);
    // `postgres` selects the server-side blob registry (storage/server/blob-api.ts),
    // never a browser data layer: these repositories reach the database over
    // PostgREST, which a connection string cannot replace. Point them at your own
    // database with NEXT_PUBLIC_DATA_URL instead — see docs/running/backend.md.
    default:
      throw new Error(
        `Backend provider "${config.provider}" has no browser data layer. Set NEXT_PUBLIC_BACKEND_PROVIDER=postgrest, ` +
          "and NEXT_PUBLIC_DATA_URL to your PostgREST.",
      );
  }
}

/** Server-only admin provisioner (null when service role key is unset). */
export function getAdminProvisioner(config: BackendConfig = readBackendConfig()): IAdminUserProvisioner | null {
  const { supabaseUrl, supabaseServiceRoleKey } = config;
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;
  return new SupabaseAdminUserProvisioner(supabaseUrl, supabaseServiceRoleKey);
}
