import type { Clock } from "../../../shared/clock.js";
import type { AddLogEntryUseCase } from "../../logbook/application/add-log-entry.use-case.js";
import type { INotificationIntegration } from "../../integrations/domain/integration-ports.js";
import type { IPaperRepository } from "../../papers/domain/paper-repository.js";
import type { Paper } from "../../papers/domain/paper.js";
import type { PaperRef } from "../../papers/application/metadata-source.js";
import type { ICitationAlertTrackRepository } from "../domain/citation-alert-track-repository.js";
import type { CitationCandidate, ICitationSource } from "./citation-source.js";
import { rankCitationAlerts } from "./rank-citation-alerts.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CitationAlertCheckResult {
  tracked: number;
  checked: number;
  found: number;
}

function paperRef(paper: Paper): PaperRef | null {
  if (paper.arxivId) return { kind: "arxiv", value: paper.arxivId };
  if (paper.doi) return { kind: "doi", value: paper.doi };
  return null;
}

function mergeSeenIds(prior: readonly string[], current: readonly CitationCandidate[]): string[] {
  // Always union — a truncated/partial S2 page must not forget older ids
  // (that would make them look "new" on a later complete fetch).
  const out = new Set(prior);
  for (const item of current) out.add(item.id);
  return [...out];
}

function intentLabel(item: CitationCandidate): string | null {
  if (item.isInfluential === true) {
    const intent = item.intents?.find((i) => i === "result" || i === "method") ?? item.intents?.[0];
    return intent ? `influential · ${intent}` : "influential";
  }
  if (!item.intents?.length) return null;
  // Prefer the strongest intent for the label (result > method > background).
  for (const intent of ["result", "method", "background"] as const) {
    if (item.intents.includes(intent)) return intent;
  }
  return item.intents[0] ?? null;
}

function logBody(paper: Paper, citing: CitationCandidate[]): string {
  const ranked = rankCitationAlerts(citing);
  const lines = [
    `## Citation alert: ${paper.title}`,
    "",
    `${ranked.length} new paper${ranked.length === 1 ? "" : "s"} cited this tracked paper:`,
    "",
  ];
  for (const item of ranked.slice(0, 20)) {
    const author = item.authors[0];
    const intent = intentLabel(item);
    const meta = [
      intent ? `\`${intent}\`` : null,
      author ? `${author}${item.authors.length > 1 ? " et al." : ""}` : null,
      item.year,
      typeof item.citationCount === "number"
        ? `${item.citationCount.toLocaleString()} citation${item.citationCount === 1 ? "" : "s"}`
        : null,
    ]
      .filter(Boolean)
      .join(", ");
    const title = item.url ? `[${item.title}](${item.url})` : item.title;
    lines.push(`- ${title}${meta ? ` — ${meta}` : ""}`);
  }
  if (ranked.length > 20) lines.push(`- …and ${ranked.length - 20} more`);
  return lines.join("\n");
}

export class CheckCitationAlertsUseCase {
  /** Serialize runs so a forced manual check is not swallowed by an in-flight daily poll. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: {
      papers: IPaperRepository;
      tracks: ICitationAlertTrackRepository;
      sources: ICitationSource[];
      logs: AddLogEntryUseCase;
      notifications: INotificationIntegration;
      clock: Clock;
      /** Live project scope; when it changes mid-run, stop before further writes. */
      getProjectId?: () => string | null;
    },
  ) {}

  async isTracking(paperId: string): Promise<boolean> {
    return (await this.deps.tracks.getByPaperId(paperId)) != null;
  }

  async setTracking(paperId: string, enabled: boolean): Promise<Paper> {
    const paper = await this.deps.papers.getById(paperId);
    if (!paper) throw new Error(`No paper with id "${paperId}".`);
    if (!enabled) {
      await this.deps.tracks.untrack(paperId);
      return paper;
    }

    const ref = paperRef(paper);
    if (!ref) throw new Error("Citation alerts require a DOI or arXiv ID.");
    const source = this.deps.sources.find((item) => item.supports(ref) && item.citations);
    if (!source?.citations) throw new Error("No citation-alert provider is configured.");

    // Baseline existing citations when tracking starts so only future citations alert.
    const now = this.deps.clock.nowIso();
    const existing = await this.deps.tracks.getByPaperId(paperId);
    const current = await source.citations(ref);
    await this.deps.tracks.track({
      paperId,
      lastCheckedAt: now,
      seenCitingIds: mergeSeenIds(existing?.seenCitingIds ?? [], current),
    });
    return paper;
  }

  checkAll(force = false): Promise<CitationAlertCheckResult> {
    const run = this.queue.then(() => this.execute(force));
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private scoped(): boolean {
    const getId = this.deps.getProjectId;
    return !getId || getId() === this.boundProjectId;
  }

  private boundProjectId: string | null = null;

  private async execute(force: boolean): Promise<CitationAlertCheckResult> {
    this.boundProjectId = this.deps.getProjectId?.() ?? null;
    const tracks = await this.deps.tracks.listForProject();
    const result: CitationAlertCheckResult = { tracked: tracks.length, checked: 0, found: 0 };

    for (const track of tracks) {
      if (!this.scoped()) return result;

      try {
        const paper = await this.deps.papers.getById(track.paperId);
        if (!paper) {
          if (this.scoped()) await this.deps.tracks.untrack(track.paperId);
          continue;
        }
        const now = this.deps.clock.nowIso();
        if (!force && track.lastCheckedAt) {
          const elapsed = Date.parse(now) - Date.parse(track.lastCheckedAt);
          if (Number.isFinite(elapsed) && elapsed < DAY_MS) continue;
        }
        const ref = paperRef(paper);
        if (!ref) continue;
        const source = this.deps.sources.find((item) => item.supports(ref) && item.citations);
        if (!source?.citations) continue;

        const current = await source.citations(ref);
        if (!this.scoped()) return result;

        // Honor untrack during the fetch — never re-create a disabled watch.
        const latest = await this.deps.tracks.getByPaperId(track.paperId);
        if (!latest) continue;

        const seen = new Set(latest.seenCitingIds);
        const fresh = rankCitationAlerts(current.filter((item) => !seen.has(item.id)));
        const seenCitingIds = mergeSeenIds(latest.seenCitingIds, current);

        if (fresh.length > 0) {
          // Persist seen only after the in-app log succeeds so a failed write can retry.
          await this.deps.logs.add({
            body: logBody(paper, fresh),
            links: [{ type: "paper", id: paper.id }],
          });
          // Mattermost is optional and should never prevent in-app alert delivery.
          await this.deps.notifications.notifyCitationAlert(paper, fresh).catch(() => undefined);
        }

        if (!this.scoped()) return result;
        const still = await this.deps.tracks.getByPaperId(track.paperId);
        if (!still) continue;

        await this.deps.tracks.save({
          ...still,
          lastCheckedAt: now,
          seenCitingIds,
        });
        result.checked += 1;
        result.found += fresh.length;
      } catch {
        // One paper failing (S2/network) must not skip the rest of the project's tracks.
        continue;
      }
    }
    return result;
  }
}
