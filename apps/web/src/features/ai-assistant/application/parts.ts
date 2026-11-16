import { desktop } from "@/lib/desktop/desktop-bridge";
import { readyCore, typedCore } from "@/lib/rust-core";
import {
  type ILogEntryManager,
  type AddPaperUseCase,
  type AddRelationUseCase,
  type AiProposalExecution,
  type AiWriteProposal,
  EXPERIMENT_STATUSES,
  FOLDER_DRAFTS_DIR,
  type FolderDraft,
  type IAiPaperNoteAppender,
  type IAiProposalExecutor,
  type IConceptExtractor,
  type IReaderAnnotationSink,
  type IWorkspaceFs,
  type IExperimentManager,
  type IMilestoneManager,
  type IReportSectionManager,
  type IVaultPageManager,
  type ManagePaperFieldsUseCase,
  type ManageReadingListUseCase,
  ModelConceptExtractor,
  proposalApplies,
  type UpdatePaperUseCase,
} from "@weaveforge/core";
import {
  ByokModelConversation,
  type ProviderDescriptor,
} from "../infrastructure/byok-model-conversation";

// --- ai-provider-session ---
/**
 * The model the user has pointed at, for as long as the tab is open.
 *
 * In memory only. The key is a credential the user controls, and writing it to
 * localStorage or IndexedDB would turn it into one this app stores — recoverable
 * by anything that can read the origin's storage, and outliving the session that
 * needed it. The cost is re-entering it after a reload, which is the honest
 * price of not holding it.
 *
 * A module-level value rather than React state because the wiki screen and the
 * settings panel are unrelated trees, and threading a provider through a context
 * would put a credential in the component graph for no gain.
 *
 * The desktop build may keep it across launches, and only because the machine
 * offers somewhere this app does not manage: `remember` hands it to the
 * operating system's keychain through the shell (`readSecret`/`writeSecret`),
 * where it is encrypted under the reader's own account. That is a different
 * thing from localStorage, not a relaxation of the rule above — the rule is
 * that we do not hold the key, and a keychain the OS owns does not become
 * storage we manage by being convenient. In a browser the functions below are
 * no-ops, so the memory-only behaviour is the default everywhere and the
 * exception has to be asked for.
 */

interface ActiveProvider {
  descriptor: ProviderDescriptor;
  apiKey: string;
}

let active: ActiveProvider | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Subscribe to configuration changes. Returns an unsubscribe function. */
export function onProviderChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setActiveProvider(descriptor: ProviderDescriptor, apiKey: string): void {
  active = { descriptor, apiKey };
  notify();
}

export function clearActiveProvider(): void {
  active = null;
  notify();
}

/** What is configured, without the key — safe to render. */
export function activeProviderLabel(): { label: string; model: string } | null {
  return active ? { label: active.descriptor.label, model: active.descriptor.model } : null;
}

/** The name the shell files this under. */
const SECRET = "ai-provider" as const;

/** Whether this build can keep a key at all — false in every browser. */
export function canRemember(): boolean {
  return desktop() !== null;
}

/**
 * Hand the configured provider to the machine's keychain.
 *
 * Rejects rather than reporting success when there is nothing configured or no
 * keychain backend, because the caller renders the difference: a refusal means
 * the key is still live for this session and will be gone after a reload,
 * which the reader has to be told rather than left to discover.
 */
export async function rememberActiveProvider(): Promise<void> {
  const bridge = desktop();
  if (!bridge) throw new Error("This build cannot store keys.");
  if (!active) throw new Error("No provider is configured.");
  await bridge.writeSecret(SECRET, JSON.stringify(active));
}

/** Forget the stored copy, if this build has one. Leaves the session alone. */
export async function forgetStoredProvider(): Promise<void> {
  await desktop()?.clearSecret(SECRET);
}

/**
 * Restore a remembered provider, and answer whether there was one.
 *
 * Anything unreadable counts as nothing stored. The blob is written by this
 * module, but it survives upgrades that change the descriptor's shape, and a
 * half-valid provider would fail later at the model call — where the message
 * would be the provider's rather than ours.
 */
export async function restoreActiveProvider(): Promise<boolean> {
  const bridge = desktop();
  if (!bridge) return false;
  const stored = await bridge.readSecret(SECRET);
  if (!stored) return false;
  const parsed = parseStored(stored);
  if (!parsed) return false;
  setActiveProvider(parsed.descriptor, parsed.apiKey);
  return true;
}

function parseStored(raw: string): ActiveProvider | null {
  return readyCore().parseStoredAiProvider(raw) as ActiveProvider | null;
}

/**
 * A model-backed extractor, or null when nothing is configured.
 *
 * Returning null rather than throwing lets callers fall back to the lexical
 * extractor, which is the point of having one: the wiki works with no key at
 * all, and a configured model makes it better rather than making it possible.
 */
export function modelExtractor(): IConceptExtractor | null {
  const conversation = modelConversation();
  return conversation && active ? new ModelConceptExtractor(conversation, { model: active.descriptor.model }) : null;
}

/** A conversation with the configured model, or null when nothing is configured. */
export function modelConversation(): ByokModelConversation | null {
  return active ? new ByokModelConversation(active.descriptor, active.apiKey) : null;
}

// --- import-folder-drafts ---
/**
 * Move the local MCP's suggestions from the folder into the review queue.
 *
 * Each file is deleted and then queued as one pending proposal, so a draft is
 * queued once: a file that cannot be deleted is skipped, and a draft the queue
 * refuses is written back for the next pass. One refusal does not hold back
 * the rest; the first error is thrown once every draft has been tried.
 * Files that are not drafts are left alone for the user to see.
 * A draft for another project waits until that project is open.
 * Nothing here applies a draft: approval stays in the review queue.
 */
export async function importFolderDrafts(
  fs: IWorkspaceFs,
  queue: (draft: FolderDraft) => Promise<unknown>,
  projectId?: string,
): Promise<number> {
  const entries = await fs.list(FOLDER_DRAFTS_DIR).catch(() => []);
  let imported = 0;
  let firstError: unknown = null;
  for (const entry of entries) {
    if (entry.kind !== "file" || !typedCore().isFolderDraftPath(entry.path)) continue;
    const raw = await fs.readText(entry.path).catch(() => null);
    const draft = raw === null ? null : (typedCore().folderDraftForProject(raw, projectId) as FolderDraft | null);
    if (!draft) continue;
    try {
      await fs.remove(entry.path);
    } catch {
      continue;
    }
    try {
      await queue(draft);
      imported += 1;
    } catch (err) {
      firstError ??= err;
      await fs.writeFile(entry.path, raw!).catch(() => undefined);
    }
  }
  if (firstError !== null) throw firstError;
  return imported;
}

type ImportArgs = Parameters<typeof importFolderDrafts>;

let running: Promise<number> | null = null;
let again = false;
let latest: ImportArgs | null = null;

/**
 * One import at a time; a call during a run schedules one more pass after it,
 * and that pass uses the latest call's folder, queue and project.
 */
export function importFolderDraftsOnce(
  fs: IWorkspaceFs,
  queue: (draft: FolderDraft) => Promise<unknown>,
  projectId?: string,
): Promise<number> {
  latest = [fs, queue, projectId];
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let total = 0;
    do {
      again = false;
      total += await importFolderDrafts(...latest!);
    } while (again);
    return total;
  })().finally(() => {
    running = null;
  });
  return running;
}

// --- proposal-executors ---
/**
 * Typed browser-only approval executors. The payload checks and the wiki-side
 * shaping live in the Rust core (wf-core `ai::proposal_inputs`, `ai::proposal_apply`);
 * this file keeps the host work: revision checks, the ink guard, and the calls into
 * the use cases. Invalid drafts fail closed before a write.
 */
export function createAiProposalExecutors(deps: {
  paperNotes: IAiPaperNoteAppender;
  vault: IVaultPageManager;
  logs: ILogEntryManager;
  papers: { getById(id: string): Promise<{ id: string; updatedAt: string } | null> };
  updatePaper: UpdatePaperUseCase;
  paperFields: Pick<ManagePaperFieldsUseCase, "setValue" | "listDefs">;
  addPaper: AddPaperUseCase;
  pushZotero: (paper: Awaited<ReturnType<AddPaperUseCase["addManual"]>>) => Promise<void>;
  lists: ManageReadingListUseCase;
  relations: AddRelationUseCase;
  milestones: IMilestoneManager;
  experiments: IExperimentManager;
  vaultPages: { getById(id: string): Promise<{ id: string; body: string; updatedAt: string } | null> };
  reportSections: Pick<IReportSectionManager, "setNotes">;
  reportSectionById: (id: string) => Promise<{ id: string; updatedAt?: string } | null>;
  annotations: Pick<IReaderAnnotationSink, "create">;
}): readonly IAiProposalExecutor[] {
  // Ink notes are strokes behind a header line; a text edit would destroy them.
  const editableNote = async (proposal: AiWriteProposal) => {
    const page = await deps.vaultPages.getById(proposal.resourceId);
    if (!proposalApplies(page, proposal.expectedRevision)) return null;
    if (readyCore().isInkNoteBody(page.body)) throw new Error("Ink notes cannot be edited by a suggestion.");
    return page;
  };
  return [
    executor("append_paper_note", async (proposal) => {
      const addition = readyCore().proposalPaperNoteAddition(proposal.payload, proposal.content);
      return (await deps.paperNotes.appendPaperNote({ paperId: proposal.resourceId, addition, expectedRevision: proposal.expectedRevision })) === "appended" ? "accepted" : "conflicted";
    }),
    executor("create_vault_note", async (proposal) => {
      await deps.vault.add(readyCore().proposalVaultNote(proposal.payload) as Arg<IVaultPageManager["add"]>);
      return "accepted";
    }),
    executor("create_log_entry", async (proposal) => {
      await deps.logs.add(readyCore().proposalLogEntry(proposal.payload) as Arg<ILogEntryManager["add"]>);
      return "accepted";
    }),
    executor("paper_update", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!proposalApplies(paper, proposal.expectedRevision)) return "conflicted";
      const update = readyCore().proposalPaperUpdate(proposal.payload);
      if (update.status) await deps.updatePaper.setStatus(paper.id, update.status as Arg<UpdatePaperUseCase["setStatus"], 1>);
      if (update.rating != null) await deps.updatePaper.setRating(paper.id, update.rating);
      if (update.tags) await deps.updatePaper.mergeTags(paper.id, update.tags, "manual");
      return "accepted";
    }),
    executor("paper_field_value", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!proposalApplies(paper, proposal.expectedRevision)) return "conflicted";
      // The field id is read before the fields are listed, so a bad payload fails before the lookup.
      readyCore().proposalPaperFieldId(proposal.payload);
      const defs = await deps.paperFields.listDefs();
      const fill = readyCore().proposalPaperFieldFill(proposal.payload, defs);
      await deps.paperFields.setValue(paper.id, fill.fieldId, fill.value);
      return "accepted";
    }),
    executor("reading_list_change", async (proposal) => {
      const change = readyCore().proposalReadingListChange(proposal.payload);
      const note = change.note ?? undefined;
      if (change.target.kind === "paper") await deps.lists.addPaperToList(change.listId, change.target.id, note);
      else await deps.lists.addNoteToList(change.listId, change.target.id, note);
      return "accepted";
    }),
    executor("relation", async (proposal) => {
      await deps.relations.add({ ...readyCore().proposalRelation(proposal.payload), source: "manual" } as Arg<AddRelationUseCase["add"]>);
      return "accepted";
    }),
    executor("zotero_import", async (proposal) => {
      await deps.pushZotero(await deps.addPaper.addManual(readyCore().proposalZoteroImport(proposal.payload) as Arg<AddPaperUseCase["addManual"]>));
      return "accepted";
    }),
    executor("milestone_follow_up", async (proposal) => {
      await deps.milestones.add(readyCore().proposalMilestoneFollowUp(proposal.payload) as Arg<IMilestoneManager["add"]>);
      return "accepted";
    }),
    executor("experiment_follow_up", async (proposal) => {
      await deps.experiments.add(readyCore().proposalExperimentFollowUp(proposal.payload) as Arg<IExperimentManager["add"]>);
      return "accepted";
    }),
    executor("edit_vault_note", async (proposal) => {
      const page = await editableNote(proposal);
      if (!page) return "conflicted";
      await deps.vault.update(page.id, readyCore().proposalEditVaultNote(proposal.payload) as Arg<IVaultPageManager["update"], 1>);
      return "accepted";
    }),
    executor("append_vault_note", async (proposal) => {
      const page = await editableNote(proposal);
      if (!page) return "conflicted";
      await deps.vault.update(page.id, { body: readyCore().proposalAppendVaultNoteBody(page.body, proposal.payload) });
      return "accepted";
    }),
    executor("report_edit", async (proposal) => {
      const section = await deps.reportSectionById(proposal.resourceId);
      if (!section) return "conflicted";
      if (proposal.expectedRevision && section.updatedAt !== proposal.expectedRevision) return "conflicted";
      await deps.reportSections.setNotes(section.id, readyCore().proposalReportNotes(proposal.payload));
      return "accepted";
    }),
    executor("milestone_status", async (proposal) => {
      const status = readyCore().proposalMilestoneStatus(proposal.payload) as Parameters<IMilestoneManager["setStatus"]>[1];
      await deps.milestones.setStatus(proposal.resourceId, status);
      return "accepted";
    }),
    executor("experiment_update", async (proposal) => {
      const update = readyCore().proposalExperimentUpdate(proposal.payload) as {
        status?: (typeof EXPERIMENT_STATUSES)[number];
        metrics?: Record<string, unknown>;
        artifacts?: string[];
      };
      if (update.status) await deps.experiments.setStatus(proposal.resourceId, update.status);
      if (update.metrics) await deps.experiments.recordMetrics(proposal.resourceId, update.metrics);
      if (update.artifacts) await deps.experiments.addArtifacts(proposal.resourceId, update.artifacts);
      return "accepted";
    }),
    executor("paper_annotation", async (proposal) => {
      const paper = await deps.papers.getById(proposal.resourceId);
      if (!paper) return "conflicted";
      // Quote-anchored: the reader finds the words on the page, no rects needed.
      await deps.annotations.create(paper.id, readyCore().proposalPaperAnnotation(proposal.payload) as Arg<IReaderAnnotationSink["create"], 1>);
      return "accepted";
    }),
  ];
}

/**
 * The use case's argument type. The Rust core checks every value it returns (statuses, relation
 * names, annotation types) and omits absent fields, so its looser generated types narrow safely.
 */
type Arg<F extends (...args: never[]) => unknown, I extends number = 0> = Parameters<F>[I];

function executor(kind: IAiProposalExecutor["kind"], execute: (proposal: AiWriteProposal) => Promise<AiProposalExecution>): IAiProposalExecutor { return { kind, execute }; }

// --- proposal-groups ---
/** How the review queue groups pending proposals. */
export type ProposalGrouping = "document" | "kind";

export interface ProposalGroup {
  /** The resource id or the proposal kind, depending on the grouping. */
  key: string;
  items: AiWriteProposal[];
}

/** Key prefix for a document group whose target is unknown (see `groupProposals`). */
export const KIND_GROUP_PREFIX = "kind:";

/**
 * Groups in the order their first proposal appears; items keep queue order.
 * The grouping rule lives in wf-core (`proposal_groups`).
 *
 * By document, a resource id not in `knownIds` (a "create" suggestion's fresh
 * id, or a target not in the catalog) is grouped under `kind:<kind>` instead.
 */
export function groupProposals(
  items: readonly AiWriteProposal[],
  by: ProposalGrouping,
  knownIds?: readonly string[],
): ProposalGroup[] {
  return readyCore()
    .groupProposals(items, by, knownIds ? [...knownIds] : undefined)
    .map(({ key, indices }) => ({ key, items: indices.map((index) => items[index] as AiWriteProposal) }));
}

export interface BulkResult {
  done: string[];
  /** Not applied: the target changed since the proposal was made. */
  conflicted: string[];
  /** The apply that threw, which stopped the batch. */
  failed: { id: string; error: unknown } | null;
  /** Never tried because of `failed`; still pending. */
  untouched: string[];
}

/**
 * Apply each id once, in order. A conflict is an expected answer and the batch
 * carries on; a thrown error is not, so the batch stops and the rest stay
 * pending for the reviewer to look at.
 */
export async function runBulk(
  ids: readonly string[],
  apply: (id: string) => Promise<"accepted" | "conflicted" | void>,
): Promise<BulkResult> {
  const unique = [...new Set(ids)];
  const result: BulkResult = { done: [], conflicted: [], failed: null, untouched: [] };
  for (const [index, id] of unique.entries()) {
    try {
      if ((await apply(id)) === "conflicted") result.conflicted.push(id);
      else result.done.push(id);
    } catch (error) {
      result.failed = { id, error };
      result.untouched = unique.slice(index + 1);
      break;
    }
  }
  return result;
}
