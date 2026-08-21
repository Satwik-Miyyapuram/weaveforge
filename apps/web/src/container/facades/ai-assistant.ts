import type { Experiment, ILogEntryRepository, LogEntry, Milestone, Paper, ReadingList, VaultPage } from "@weaveforge/core";
import {
  AI_TOOL_NAMES,
  AiAccessPolicy,
  aiReadCategoryForResource,
  CreateAiSessionGrantUseCase,
  CreateAiProposalDraftUseCase,
  retrieveAiExcerpts,
  type AiAccessSettings,
  type AiActiveSession,
  type AiRetrievedExcerpt,
  type AiRetrievalDocument,
  type AiProposalKind,
  type AiResourceType,
  type AiWorkspaceSource,
  type AiToolName,
  ExecuteAiProposalUseCase,
  AiProposalExecutorRegistry,
  type AiWriteProposal,
  type IAiAuditStore,
  type IAiProposalStore,
} from "@weaveforge/core";
import { singleFlight } from "@/lib/cache/single-flight";

/** How long the pending-proposal count is reused across the shell's badges. */
const PENDING_PROPOSALS_MEMO_MS = 15_000;

export interface AiSourceOption extends AiWorkspaceSource {
  category: string;
}

interface StoredZoteroEntry {
  key?: string;
  kind?: "annotation" | "note";
  text?: string;
  comment?: string;
  color?: string;
  tags?: string[];
}

/** Browser-local grant manager. Sessions intentionally disappear on reload/sign-out. */
export class AiAssistantFacade {
  private readonly sessions = new Map<string, AiActiveSession>();
  private readonly createGrant = new CreateAiSessionGrantUseCase();
  private readonly policy = new AiAccessPolicy();
  private readonly createProposal: CreateAiProposalDraftUseCase;

  constructor(
    private readonly deps: {
      papers: import("@weaveforge/core").IPaperRepository;
      vaultPages: import("@weaveforge/core").IVaultPageRepository;
      readingLists: import("@weaveforge/core").IReadingListRepository;
      logEntries: ILogEntryRepository;
      experiments: import("@weaveforge/core").IExperimentRepository;
      milestones: import("@weaveforge/core").IMilestoneRepository;
      proposals: IAiProposalStore;
      isEncryptionUnlocked: () => boolean;
      newId: () => string;
      now: () => string;
      /** Deployment MCP allowlist; falls back to core AI_TOOL_NAMES when omitted. */
      allowedTools?: readonly AiToolName[];
    },
  ) {
    this.createProposal = new CreateAiProposalDraftUseCase({
      policy: this.policy, proposals: deps.proposals, clock: { nowIso: deps.now },
    });
  }

  async listSourceOptions(): Promise<readonly AiSourceOption[]> {
    const [papers, vaultPages, readingLists, logEntries, experiments, milestones] = await Promise.all([
      this.deps.papers.list(),
      this.deps.vaultPages.list(),
      this.deps.readingLists.list(),
      this.deps.logEntries.list(),
      this.deps.experiments.list(),
      this.deps.milestones.list(),
    ]);
    const source = (resourceType: AiResourceType, resourceId: string, label: string, category: string, href?: string): AiSourceOption => ({
      sourceId: `${resourceType}:${resourceId}`,
      resourceType,
      resourceId,
      label,
      category,
      href,
    });
    return [
      ...papers.map((paper) => source("paper", paper.id, paper.title, "Papers", `/papers?paper=${encodeURIComponent(paper.id)}`)),
      ...papers.filter((paper) => Boolean(paper.summary?.trim())).map((paper) =>
        source("paper_note", paper.id, `${paper.title} — paper note`, "Paper notes", `/papers?paper=${encodeURIComponent(paper.id)}#paper-note`)),
      ...papers.flatMap((paper) => this.zoteroEntries(paper).map((entry, index) =>
        source(
          entry.kind === "note" ? "zotero_note" : "zotero_annotation",
          this.zoteroResourceId(paper.id, entry, index),
          `${paper.title} — Zotero ${entry.kind === "note" ? "note" : "annotation"}`,
          "Zotero annotations and notes",
          `/papers?paper=${encodeURIComponent(paper.id)}#zotero-${encodeURIComponent(entry.key ?? `${entry.kind ?? "annotation"}-${index}`)}`,
        ))),
      ...readingLists.map((list) => source("reading_list", list.id, list.name, "Reading lists", `/lists?list=${encodeURIComponent(list.id)}`)),
      ...vaultPages.map((page) => source("vault_page", page.id, page.title, "Vault notes", `/notes?page=${encodeURIComponent(page.id)}`)),
      ...logEntries.map((entry) => source("log_entry", entry.id, `${entry.entryDate} ${entry.kind}`, "Logbook", `/log`)),
      ...experiments.map((experiment) => source("experiment", experiment.id, experiment.name, "Experiments", `/experiments?focus=${encodeURIComponent(experiment.id)}`)),
      ...milestones.map((milestone) => source("milestone", milestone.id, milestone.title, "Milestones", `/plan`)),
    ];
  }

  async startSession(input: {
    workspaceName: string;
    sourceIds: readonly string[];
    settings: AiAccessSettings;
    proposalCapabilities: readonly AiProposalKind[];
    ttlMinutes?: number;
  }): Promise<AiActiveSession> {
    const options = await this.listSourceOptions();
    const byId = new Map(options.map((option) => [option.sourceId, option]));
    const sources = input.sourceIds.map((sourceId) => {
      const source = byId.get(sourceId);
      if (!source) throw new Error("One or more selected sources are no longer available.");
      return source;
    });
    const session = this.createGrant.execute({
      id: this.deps.newId(),
      workspaceName: input.workspaceName,
      sources,
      settings: input.settings,
      encryptionUnlocked: this.deps.isEncryptionUnlocked(),
      now: this.deps.now(),
      ttlMs: input.ttlMinutes == null ? undefined : input.ttlMinutes * 60_000,
      allowedTools: this.deps.allowedTools?.length ? this.deps.allowedTools : AI_TOOL_NAMES,
      proposalCapabilities: input.proposalCapabilities,
    });
    this.sessions.set(session.grant.id, session);
    return session;
  }

  /**
   * Repopulate the in-memory session Map from persisted grants after a reload.
   * Expired or (once locked) all grants are dropped by listActiveSessions.
   */
  restoreActiveSessions(sessions: readonly AiActiveSession[]): void {
    if (!this.deps.isEncryptionUnlocked()) return;
    const nowMs = Date.parse(this.deps.now());
    for (const session of sessions) {
      if (Date.parse(session.grant.expiresAt) > nowMs) this.sessions.set(session.grant.id, session);
    }
  }

  listActiveSessions(now = this.deps.now()): readonly AiActiveSession[] {
    if (!this.deps.isEncryptionUnlocked()) {
      this.sessions.clear();
      return [];
    }
    const nowMs = Date.parse(now);
    for (const [id, session] of this.sessions) {
      if (Date.parse(session.grant.expiresAt) <= nowMs) this.sessions.delete(id);
    }
    return [...this.sessions.values()].sort((a, b) => a.grant.expiresAt.localeCompare(b.grant.expiresAt));
  }

  revokeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  revokeAll(): void {
    this.sessions.clear();
  }

  /**
   * Runs in the unlocked browser. The returned text is intentionally bounded
   * and is the only content a future MCP bridge may disclose to Codex.
   */
  async searchWorkspace(input: {
    sessionId: string;
    query: string;
    settings: AiAccessSettings;
    limit?: number;
  }): Promise<readonly AiRetrievedExcerpt[]> {
    const session = this.requireActiveSession(input.sessionId);
    const docs = await this.readGrantedDocuments(session, input.settings, "search_workspace");
    return retrieveAiExcerpts(docs, input.query, { limit: input.limit });
  }

  async getSourceExcerpt(input: {
    sessionId: string;
    sourceId: string;
    settings: AiAccessSettings;
  }): Promise<AiRetrievalDocument | null> {
    const session = this.requireActiveSession(input.sessionId);
    const docs = await this.readGrantedDocuments(session, input.settings, "get_source_excerpt");
    const document = docs.find((candidate) => candidate.source.sourceId === input.sourceId);
    return document ? { ...document, text: boundedMcpExcerpt(document.text) } : null;
  }

  async getWorkspaceOutline(input: { sessionId: string; settings: AiAccessSettings }): Promise<readonly AiWorkspaceSource[]> {
    const session = this.requireActiveSession(input.sessionId);
    const readable = await this.readableSources(session, input.settings);
    const effectiveSession: AiActiveSession = { ...session, grant: { ...session.grant, readable } };
    for (const source of readable) {
      this.assertReadable(effectiveSession, input.settings, source, "get_workspace_outline");
    }
    return readable;
  }

  /** Persist a typed encrypted draft. This is the only live MCP proposal surface. */
  async proposeDraft(input: {
    sessionId: string; settings: AiAccessSettings; kind: AiProposalKind; tool: AiToolName;
    content: string; payload: Record<string, unknown>; resourceId?: string; resourceType?: AiResourceType;
    expectedRevision?: string; evidence?: readonly import("@weaveforge/core").AiEvidence[];
  }): Promise<{ status: "requires_review"; proposalId: string; kind: AiProposalKind; message: string }> {
    const session = this.requireActiveSession(input.sessionId);
    const proposal = await this.createProposal.execute({
      id: this.deps.newId(), kind: input.kind, tool: input.tool,
      resourceId: input.resourceId ?? this.deps.newId(), resourceType: input.resourceType,
      content: input.content, payload: input.payload, expectedRevision: input.expectedRevision,
      evidence: input.evidence, settings: input.settings, grant: session.grant,
      encryptionUnlocked: this.deps.isEncryptionUnlocked(), now: this.deps.now(),
    });
    return { status: "requires_review", proposalId: proposal.id, kind: proposal.kind, message: "Draft saved securely. Review and approve it in WeaveForge before anything changes." };
  }

  /** Build and persist a review-only Zotero import. It never reads credentials. */
  async proposeZoteroImport(input: {
    sessionId: string; settings: AiAccessSettings; title: string; authors?: readonly string[];
    doi?: string; url?: string; year?: string | number; abstract?: string;
  }): Promise<{ status: "requires_review"; proposalId: string; kind: AiProposalKind; message: string }> {
    const title = input.title.trim();
    if (!title) throw new Error("A Zotero proposal needs a title.");
    const item = {
        itemType: "journalArticle", title,
        creators: (input.authors ?? []).map((name) => ({ name: name.trim(), creatorType: "author" })).filter((creator) => creator.name),
        DOI: input.doi?.trim() || undefined, url: input.url?.trim() || undefined,
        date: input.year == null ? undefined : String(input.year), abstractNote: input.abstract?.trim() || undefined,
    };
    return this.proposeDraft({ sessionId: input.sessionId, settings: input.settings, kind: "zotero_import", tool: "propose_zotero_import", content: `Import “${title}” into Zotero`, payload: { title, authors: input.authors ?? [], doi: input.doi, url: input.url, year: input.year, abstract: input.abstract, item } });
  }

  private requireActiveSession(sessionId: string): AiActiveSession {
    const session = this.sessions.get(sessionId);
    if (!session || !this.deps.isEncryptionUnlocked() || Date.parse(session.grant.expiresAt) <= Date.parse(this.deps.now())) {
      this.sessions.delete(sessionId);
      throw new Error("Open WeaveForge and unlock encryption to access this workspace.");
    }
    return session;
  }

  private assertReadable(session: AiActiveSession, settings: AiAccessSettings, source: AiWorkspaceSource, tool: AiToolName): void {
    const decision = this.policy.evaluate({
      settings,
      grant: session.grant,
      encryptionUnlocked: this.deps.isEncryptionUnlocked(),
      now: this.deps.now(),
      tool,
      resourceType: source.resourceType,
      resourceId: source.resourceId,
    });
    if (!decision.allowed) throw new Error(`AI source access denied: ${decision.reason}`);
  }

  private async readGrantedDocuments(session: AiActiveSession, settings: AiAccessSettings, tool: AiToolName): Promise<readonly AiRetrievalDocument[]> {
    const [papers, vaultPages, readingLists, logEntries, experiments, milestones] = await Promise.all([
      this.deps.papers.list(), this.deps.vaultPages.list(), this.deps.readingLists.list(),
      this.deps.logEntries.list(), this.deps.experiments.list(), this.deps.milestones.list(),
    ]);
    const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((item) => [item.id, item]));
    const indexes = {
      papers: byId(papers), vaultPages: byId(vaultPages), readingLists: byId(readingLists),
      logEntries: byId(logEntries), experiments: byId(experiments), milestones: byId(milestones),
      zoteroEntries: new Map(papers.flatMap((paper) => this.zoteroEntries(paper).map((entry, index) =>
        [this.zoteroResourceId(paper.id, entry, index), { paper, entry }]))),
    };
    const readable = await this.readableSources(session, settings);
    const effectiveSession: AiActiveSession = { ...session, grant: { ...session.grant, readable } };
    return readable.flatMap((source) => {
      this.assertReadable(effectiveSession, settings, source, tool);
      const text = this.sourceText(source, indexes);
      if (!text) return [];
      return [{ source: { ...source, label: source.label ?? source.sourceId }, text }];
    });
  }

  /** Re-evaluate auto-inclusion at request time; never add a disabled category. */
  private async readableSources(session: AiActiveSession, settings: AiAccessSettings): Promise<readonly AiWorkspaceSource[]> {
    const dynamicCategories = new Set(settings.autoIncludeNewSourceCategories ?? []);
    const sourceOptions = await this.listSourceOptions();
    return [
      ...session.grant.readable,
      ...sourceOptions.filter((source) => dynamicCategories.has(aiReadCategoryForResource(source.resourceType))
        && settings.readCategories.includes(aiReadCategoryForResource(source.resourceType))
        && !session.grant.readable.some((granted) => granted.sourceId === source.sourceId)),
    ];
  }

  private sourceText(
    source: AiWorkspaceSource,
    indexes: {
      papers: Map<string, import("@weaveforge/core").Paper>;
      vaultPages: Map<string, import("@weaveforge/core").VaultPage>;
      readingLists: Map<string, import("@weaveforge/core").ReadingList>;
      logEntries: Map<string, import("@weaveforge/core").LogEntry>;
      experiments: Map<string, import("@weaveforge/core").Experiment>;
      milestones: Map<string, import("@weaveforge/core").Milestone>;
      zoteroEntries: Map<string, { paper: import("@weaveforge/core").Paper; entry: StoredZoteroEntry }>;
    },
  ): string | null {
    const paper = indexes.papers.get(source.resourceId);
    if (source.resourceType === "paper" && paper) return [paper.title, paper.authors.join(", "), paper.year, paper.venue, paper.abstract, paper.status, paper.tags.join(" ")].filter(Boolean).join("\n");
    if (source.resourceType === "paper_note" && paper?.summary?.trim()) return paper.summary;
    const zotero = indexes.zoteroEntries.get(source.resourceId);
    if ((source.resourceType === "zotero_annotation" || source.resourceType === "zotero_note") && zotero) {
      return [zotero.paper.title, zotero.entry.text, zotero.entry.comment, zotero.entry.tags?.join(" ")].filter(Boolean).join("\n");
    }
    const list = indexes.readingLists.get(source.resourceId);
    if (source.resourceType === "reading_list" && list) return [list.name, list.description].filter(Boolean).join("\n");
    const vault = indexes.vaultPages.get(source.resourceId);
    if (source.resourceType === "vault_page" && vault) return [vault.title, vault.body].filter(Boolean).join("\n\n");
    const log = indexes.logEntries.get(source.resourceId);
    if (source.resourceType === "log_entry" && log) return `${log.entryDate} ${log.kind}\n${log.body}`;
    const experiment = indexes.experiments.get(source.resourceId);
    if (source.resourceType === "experiment" && experiment) return [experiment.name, experiment.hypothesis, experiment.status, experiment.resultNote, JSON.stringify(experiment.config), JSON.stringify(experiment.metrics)].filter(Boolean).join("\n");
    const milestone = indexes.milestones.get(source.resourceId);
    if (source.resourceType === "milestone" && milestone) return [milestone.title, milestone.description, milestone.status, milestone.targetDate, milestone.dependencies.map((item) => item.label ?? item.refId).filter(Boolean).join(", "), milestone.compute.map((item) => [item.resource, item.count, item.hours, item.notes].filter(Boolean).join(" ")).join("\n")].filter(Boolean).join("\n");
    return null;
  }

  private zoteroEntries(paper: import("@weaveforge/core").Paper): StoredZoteroEntry[] {
    const entries = paper.metadata?.["annotations"];
    return Array.isArray(entries) ? entries.filter((entry): entry is StoredZoteroEntry =>
      Boolean(entry) && typeof entry === "object" && (typeof entry.text === "string" || typeof entry.comment === "string"),
    ) : [];
  }

  private zoteroResourceId(paperId: string, entry: StoredZoteroEntry, index: number): string {
    return `${paperId}:${entry.key ?? `${entry.kind ?? "annotation"}-${index}`}`;
  }
}

/** MCP never receives an unbounded source body, even after explicit approval. */
function boundedMcpExcerpt(text: string, maxChars = 2_000): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

/** Browser-only review boundary. MCP tools may draft proposals but cannot reach this facade. */
export class AiProposalFacade {
  private readonly executeProposal: ExecuteAiProposalUseCase;

  constructor(private readonly deps: {
    proposals: IAiProposalStore; audit: IAiAuditStore; executors: AiProposalExecutorRegistry;
    newId: () => string; now: () => string;
  }) {
    this.executeProposal = new ExecuteAiProposalUseCase({
      proposals: deps.proposals, audit: deps.audit, executors: deps.executors,
      ids: { newId: deps.newId }, clock: { nowIso: deps.now },
    });
  }

  /**
   * Pending proposals, shared across the burst of callers a page load makes.
   *
   * The review badge is rendered by every `HeaderActions` the shell mounts —
   * nav, mobile header, menu — and they mount as the breakpoint resolves rather
   * than together, so single-flight alone still left several identical queries.
   * The short window covers the whole boot; anything that changes the queue
   * dispatches `ai-proposals-changed`, and that path clears it.
   */
  listPending(): Promise<AiWriteProposal[]> {
    const now = Date.now();
    if (this.pendingMemo && now - this.pendingMemo.at < PENDING_PROPOSALS_MEMO_MS) {
      return this.pendingMemo.value;
    }
    const value = singleFlight("ai-proposals:pending", () => this.deps.proposals.listPending());
    this.pendingMemo = { at: now, value };
    void value.catch(() => {
      if (this.pendingMemo?.value === value) this.pendingMemo = null;
    });
    return value;
  }

  private pendingMemo: { at: number; value: Promise<AiWriteProposal[]> } | null = null;

  /** Drop the memo — call after anything that changes the queue. */
  forgetPending(): void {
    this.pendingMemo = null;
  }

  /**
   * Queue a draft the user asked for themselves, from inside the app.
   *
   * Deliberately not routed through `CreateAiProposalDraftUseCase`: that path
   * exists to gate an *external* agent acting over MCP, and evaluates a session
   * grant to decide whether that agent may touch a resource. Here the actor is
   * the signed-in user clicking a button in their own workspace, so there is no
   * third party to authorise — applying the grant check would mean refusing to
   * queue work the user explicitly requested.
   *
   * The write gate is unchanged: this only produces a pending row, and nothing
   * reaches a repository until it is approved in the review queue.
   */
  async draftLocal(input: {
    kind: AiProposalKind;
    resourceId: string;
    content: string;
    payload?: Record<string, unknown>;
    sourceLinks?: readonly string[];
    expectedRevision?: string;
  }): Promise<AiWriteProposal> {
    const content = input.content.trim();
    if (!content) throw new Error("A proposal needs a preview describing what it will do.");

    const proposal: AiWriteProposal = {
      id: this.deps.newId(),
      kind: input.kind,
      resourceId: input.resourceId,
      content,
      payload: input.payload,
      createdAt: this.deps.now(),
      status: "pending",
      sourceLinks: input.sourceLinks ?? [],
      expectedRevision: input.expectedRevision,
    };
    await this.deps.proposals.save(proposal);
    this.forgetPending();
    return proposal;
  }
  async pendingCount(): Promise<number> { return (await this.listPending()).length; }
  async approve(id: string): Promise<"accepted" | "conflicted"> {
    const result = await this.executeProposal.execute(id);
    this.forgetPending();
    return result;
  }

  async reject(id: string): Promise<void> {
    const proposal = await this.deps.proposals.getById(id);
    if (!proposal) throw new Error("AI proposal not found");
    if (proposal.status !== "pending") throw new Error("AI proposal is no longer pending");
    await this.deps.proposals.save({ ...proposal, status: "rejected" });
    this.forgetPending();
    await this.deps.audit.save({ id: this.deps.newId(), proposalId: id, action: "rejected", createdAt: this.deps.now() });
  }

  async approveSafeBatch(ids: readonly string[]): Promise<void> {
    for (const id of ids) await this.approve(id);
  }
}
