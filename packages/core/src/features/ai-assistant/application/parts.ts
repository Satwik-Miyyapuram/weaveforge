import { ConflictError, NotFoundError } from "../../../shared/errors.js";
import type { Clock } from "../../../shared/parts.js";
import { rust } from "../../../shared/rust.js";
import type { IPaperRepository } from "../../papers/domain/parts.js";
import type {
  AiAccessPolicy,
  AiAccessSettings,
  AiEvidence,
  AiProposalKind,
  AiResourceType,
  AiSessionGrant,
  AiToolName,
  AiWorkspace,
  AiWorkspaceSource,
  ExtractionResult,
} from "../domain/parts.js";
import {
  type AiProposalExecution,
  type AiWriteProposal,
  appendPaperNote,
  type IAiAuditStore,
  type IAiPaperNoteAppender,
  type IAiProposalExecutor,
  type IAiProposalStore,
} from "../domain/parts.js";

// --- append-paper-note.use-case ---
/**
 * Append a note to a paper's summary, refusing to clobber a paper that moved on.
 *
 * This lived in the composition root as an object literal built for the AI
 * executor factory, which meant the one place that decides whether an approved
 * proposal still applies was also the one place that could not be tested without
 * wiring the whole container. The port it satisfies already existed.
 *
 * The method is named `appendPaperNote` rather than `execute` because that *is*
 * the port — `IAiPaperNoteAppender` — and the factory takes an implementation of
 * it. Matching the name is what lets the container hand this object straight
 * over instead of wrapping it in another object literal, which is the shape the
 * duplication came from.
 */
export class AppendPaperNoteUseCase implements IAiPaperNoteAppender {
  constructor(
    private readonly deps: {
      /**
       * One read and one narrow write. The write names the summary it replaces,
       * so it cannot erase a note or an edit that landed after the read.
       */
      papers: Pick<IPaperRepository, "getById" | "replaceSummary">;
      clock: Clock;
    },
  ) {}

  async appendPaperNote(input: {
    paperId: string;
    addition: string;
    expectedRevision?: string;
  }): Promise<"appended" | "conflicted"> {
    // Another writer can change the summary between the read and the write;
    // then the write is refused and this reads again. A few rounds settle any
    // real contention; a summary that never holds still is a conflict.
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const paper = await this.deps.papers.getById(input.paperId);
      if (!proposalApplies(paper, input.expectedRevision)) return "conflicted";

      const written = await this.deps.papers.replaceSummary(
        paper.id,
        paper.summary,
        appendPaperNote(paper.summary, input.addition),
        this.deps.clock.nowIso(),
      );
      if (written) return "appended";
    }
    return "conflicted";
  }
}

const MAX_ATTEMPTS = 3;

/**
 * Whether a proposal's expectation still holds for the stored row.
 *
 * The same comparison was written out three times — here, and twice in the
 * proposal executors — and the copies are what make it dangerous: each is a
 * write that either checks the revision or silently does not. `expectedRevision`
 * is optional, so the mistake has a shape, and it is not the obvious one:
 * comparing `stored.updatedAt !== expectedRevision` without first asking whether
 * there *is* an expectation makes every proposal without one an unconditional
 * conflict.
 *
 * A generic predicate rather than a boolean, because the callers need the row
 * afterwards: `if (!proposalApplies(paper, rev)) return "conflicted";` leaves
 * `paper` narrowed and non-null, and keeps the caller's own row type instead of
 * reducing it to the one field this looks at.
 *
 * A missing row does not apply. The proposal names something that is gone, and
 * applying it would have to invent it.
 *
 * An empty expectation counts as no expectation, which is what all three copies
 * did. That is preserved deliberately rather than tidied: changing it would
 * start refusing proposals that were previously applied, and no caller has ever
 * meant `""` as a revision.
 */
export function proposalApplies<T extends { updatedAt: string }>(
  stored: T | null,
  expectedRevision?: string,
): stored is T {
  return rust().proposalApplies(stored?.updatedAt, expectedRevision);
}

// --- create-ai-proposal-draft.use-case ---
/** The only application command allowed to persist an AI-originated draft. */
export class CreateAiProposalDraftUseCase {
  constructor(private readonly deps: {
    policy: Pick<AiAccessPolicy, "evaluate">; proposals: Pick<IAiProposalStore, "save">; clock: { nowIso(): string };
  }) {}

  async execute(input: {
    id: string; kind: AiProposalKind; tool: AiToolName; resourceId: string; content: string;
    payload: Record<string, unknown>; settings: AiAccessSettings; grant: AiSessionGrant;
    encryptionUnlocked: boolean; resourceType?: AiResourceType; expectedRevision?: string;
    sourceLinks?: readonly string[]; evidence?: readonly AiEvidence[]; now?: string;
  }): Promise<AiWriteProposal> {
    const decision = this.deps.policy.evaluate({
      settings: input.settings, grant: input.grant, encryptionUnlocked: input.encryptionUnlocked,
      now: input.now, tool: input.tool, proposalKind: input.kind,
      resourceType: input.resourceType, resourceId: input.resourceId,
    });
    if (!decision.allowed) throw new Error(`AI proposal denied: ${decision.reason}`);
    // Trimming, the blank-preview check and evidence shaping are Rust (wf-core `ai::proposal_draft`).
    const proposal = rust().shapeAiProposalDraft({
      id: input.id, kind: input.kind, resourceId: input.resourceId, content: input.content,
      payload: input.payload, createdAt: this.deps.clock.nowIso(),
      sourceLinks: input.sourceLinks ? [...input.sourceLinks] : undefined,
      expectedRevision: input.expectedRevision, evidence: input.evidence ? [...input.evidence] : undefined,
    }) as AiWriteProposal;
    await this.deps.proposals.save(proposal);
    return proposal;
  }
}

// --- create-ai-session-grant.use-case ---
export const AI_SESSION_DEFAULT_TTL_MS = 30 * 60 * 1000;
/** Long grants are still browser-memory-only and end immediately on lock, reload, or sign-out. */
export const AI_SESSION_MAX_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface AiActiveSession {
  workspace: AiWorkspace;
  grant: AiSessionGrant;
  startedAt: string;
}

export interface CreateAiSessionGrantInput {
  id: string;
  workspaceName: string;
  sources: readonly AiWorkspaceSource[];
  settings: AiAccessSettings;
  encryptionUnlocked: boolean;
  now: string;
  ttlMs?: number;
  allowedTools: readonly AiToolName[];
  proposalCapabilities: readonly AiProposalKind[];
}

/**
 * Creates a short-lived, in-memory grant. The access checks, TTL clamp and source
 * dedupe live in Rust (wf-core `ai::session_grant`). This deliberately persists neither
 * plaintext nor a reusable capability token; the caller owns its lifecycle.
 */
export class CreateAiSessionGrantUseCase {
  execute(input: CreateAiSessionGrantInput): AiActiveSession {
    return rust().startAiSession(input as never) as AiActiveSession;
  }
}

// --- execute-ai-proposal.use-case ---
/** Executes an already-reviewed proposal and records its immutable outcome. */
export class ExecuteAiProposalUseCase {
  constructor(private readonly deps: {
    proposals: IAiProposalStore; audit: IAiAuditStore; executors: Pick<IAiProposalExecutor, "execute">;
    ids: { newId(): string }; clock: { nowIso(): string };
  }) {}

  async execute(proposalId: string): Promise<AiProposalExecution> {
    const proposal = await this.deps.proposals.getById(proposalId);
    // Typed rather than bare `Error`: a missing proposal is a 404 and one that
    // has already been decided is a 409 (review-2 F5).
    if (!proposal) throw new NotFoundError("AI proposal not found");
    if (proposal.status !== "pending") throw new ConflictError("AI proposal is no longer pending");
    // Claim before running, so two approvals at once run the executor once.
    if (!(await this.deps.proposals.claimPending(proposalId))) {
      throw new ConflictError("AI proposal is no longer pending");
    }
    let status: AiProposalExecution;
    try {
      status = await this.deps.executors.execute(proposal);
    } catch (error) {
      // Nothing was decided: put it back in the queue so it can be retried.
      await this.deps.proposals.save({ ...proposal, status: "pending" });
      throw error;
    }
    // The change has landed. Never back to pending from here: a second
    // approval would apply it twice. Retry the outcome so it does not sit at
    // "executing", and say so plainly if it still cannot be saved.
    try {
      await this.saveOutcome({ ...proposal, status });
    } catch {
      throw new Error("The change was applied, but its review record could not be saved. Do not approve it again.");
    }
    await this.deps.audit.save({ id: this.deps.ids.newId(), proposalId, action: status, createdAt: this.deps.clock.nowIso() });
    return status;
  }

  private async saveOutcome(proposal: AiWriteProposal, attempts = 3): Promise<void> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.deps.proposals.save(proposal);
      } catch (error) {
        if (attempt >= attempts) throw error;
      }
    }
  }
}

// --- plan-wiki-pages.use-case ---
/**
 * Turn extracted concepts into wiki-page proposals.
 *
 * Pages are ordinary vault notes, created through the existing
 * `create_vault_note` proposal kind. That is not a shortcut — it is what makes
 * a generated page a first-class citizen: it joins the graph, search,
 * backlinks, and `[[…]]` autocomplete with no new code, and it goes through the
 * same human review as anything else the assistant writes.
 */
export interface WikiPagePlan {
  title: string;
  body: string;
  /** Documents the concept was found in, for the review queue's evidence. */
  sourceDocumentIds: string[];
  mentions: number;
}

export interface PlanWikiPagesInput {
  extraction: ExtractionResult;
  /** Titles already in the wiki; these are never proposed again. */
  existingTitles: readonly string[];
  /** Concepts below this many mentions are not worth a page of their own. */
  minMentions?: number;
  maxPages?: number;
  /** Resolve a document id to a title, for the page's mention list. */
  titleOf?(documentId: string): string | undefined;
}

/**
 * The review card's text for a planned page: a bold title the card shows as
 * its heading, a `Why:` line, then the drafted page itself (E26). Generic
 * "Create note" said nothing about which page or why.
 */
export function wikiProposalContent(plan: WikiPagePlan): string {
  return rust().wikiProposalContent(plan);
}

/**
 * Plan the pages worth creating.
 *
 * Idempotent against `existingTitles`: running twice over an unchanged
 * workspace proposes nothing the second time, which is what stops the review
 * queue filling with duplicates.
 */
export function planWikiPages(input: PlanWikiPagesInput): WikiPagePlan[] {
  // `titleOf` is resolved here, once per mentioned document, because the Rust core takes data, not callbacks.
  const titles: Record<string, string> = {};
  for (const mention of input.extraction.mentions) {
    if (mention.documentId in titles) continue;
    const title = input.titleOf?.(mention.documentId);
    if (title !== undefined) titles[mention.documentId] = title;
  }
  return rust().planWikiPages({
    extraction: input.extraction as never,
    existingTitles: [...input.existingTitles],
    minMentions: input.minMentions,
    maxPages: input.maxPages,
    titles,
  }) as WikiPagePlan[];
}
