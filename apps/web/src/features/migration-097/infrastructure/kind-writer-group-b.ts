import type {
  AiWriteProposal,
  Experiment,
  LogEntry,
  LogKind,
  LogLink,
  Milestone,
  MetricPoint,
  ReportSection,
} from "@weaveforge/core";
import type { KindWriter } from "../domain/kind-writer";
import type { FileSink, Row } from "../domain/ports";
import { FileLogEntryRepository } from "../../../backend/providers/files/file-log-entry-repo";
import { FileExperimentRepository } from "../../../backend/providers/files/file-experiment-repo";
import { FileMetricRepository } from "../../../backend/providers/files/file-metric-repo";
import { FileReportSectionRepository } from "../../../backend/providers/files/file-report-section-repo";
import { FileAiProposalStore } from "../../../backend/providers/files/file-ai-proposal-store";
import { FileMilestoneRepository } from "../../plan/infrastructure/file-milestone-repo";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

interface KindRepo {
  write(row: Row): Promise<void>;
  readBack(): Promise<Row[]>;
}

/** Drops undefined keys so absent optional fields stay absent in the row. */
function defined(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

/**
 * Group (b) kinds over the FILES repos. `projectRoot` is the folder the repos
 * sit in ("" = workspace root). Vault pages are handled elsewhere.
 */
export function createGroupBWriter(sink: FileSink, projectRoot: string): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);
  const root = () => projectRoot;
  const logs = new FileLogEntryRepository(fs, root);
  const milestones = new FileMilestoneRepository(fs, projectRoot);
  const experiments = new FileExperimentRepository(fs, root);
  const metrics = new FileMetricRepository(fs, root);
  const sections = new FileReportSectionRepository(fs, root);
  const proposals = new FileAiProposalStore(fs);

  const repos: Record<string, KindRepo> = {
    logEntries: {
      write: (row) =>
        logs.save({
          id: row.id as string,
          entryDate: row.entryDate as string,
          kind: row.kind as LogKind,
          body: row.body as string,
          links: row.links as LogLink[],
          createdAt: row.createdAt as string,
        } satisfies LogEntry),
      readBack: async () =>
        (await logs.list()).map((e) => defined({ id: e.id, entryDate: e.entryDate, kind: e.kind, body: e.body, links: e.links, createdAt: e.createdAt })),
    },
    milestones: {
      write: (row) =>
        milestones.save({
          id: row.id as string,
          title: row.title as string,
          description: row.description as string | undefined,
          status: row.status as Milestone["status"],
          targetDate: row.targetDate as string | undefined,
          dependencies: row.dependencies as Milestone["dependencies"],
          compute: row.compute as Milestone["compute"],
          createdAt: row.createdAt as string,
        }),
      readBack: async () =>
        (await milestones.list()).map((m) =>
          defined({ id: m.id, title: m.title, description: m.description, status: m.status, targetDate: m.targetDate, dependencies: m.dependencies, compute: m.compute, createdAt: m.createdAt }),
        ),
    },
    experiments: {
      write: (row) =>
        experiments.save({
          id: row.id as string,
          name: row.name as string,
          hypothesis: row.hypothesis as string | undefined,
          status: row.status as Experiment["status"],
          config: row.config as Record<string, unknown>,
          metrics: row.metrics as Record<string, unknown>,
          artifacts: row.artifacts as string[],
          createdAt: row.createdAt as string,
        }),
      readBack: async () =>
        (await experiments.list()).map((e) =>
          defined({ id: e.id, name: e.name, hypothesis: e.hypothesis, status: e.status, config: e.config, metrics: e.metrics, artifacts: e.artifacts, createdAt: e.createdAt }),
        ),
    },
    metrics: {
      write: (row) =>
        metrics.append([
          {
            experimentId: row.experimentId as string,
            metric: row.metric as string,
            step: row.step as number,
            value: row.value as number,
            wallTime: row.wallTime as string | undefined,
          } satisfies MetricPoint,
        ]),
      readBack: async () => {
        const out: Row[] = [];
        for (const e of await experiments.list()) {
          for (const p of await metrics.history(e.id, undefined, { maxPoints: 0 })) {
            out.push(defined({ experimentId: p.experimentId, metric: p.metric, step: p.step, value: p.value, wallTime: p.wallTime }));
          }
        }
        return out;
      },
    },
    reportSections: {
      write: (row) =>
        sections.save({
          id: row.id as string,
          title: row.title as string,
          sectionNo: row.sectionNo as string | undefined,
          status: row.status as ReportSection["status"],
          wordCount: row.wordCount as number,
          targetWords: row.targetWords as number | undefined,
          deadline: row.deadline as string | undefined,
          draftUrl: row.draftUrl as string | undefined,
          notes: row.notes as string | undefined,
          sortOrder: row.sortOrder as number,
          createdAt: row.createdAt as string,
        }),
      readBack: async () =>
        (await sections.list()).map((s) =>
          defined({ id: s.id, title: s.title, sectionNo: s.sectionNo, status: s.status, wordCount: s.wordCount, targetWords: s.targetWords, deadline: s.deadline, draftUrl: s.draftUrl, notes: s.notes, sortOrder: s.sortOrder, createdAt: s.createdAt, updatedAt: s.updatedAt }),
        ),
    },
    aiProposals: {
      write: (row) =>
        proposals.save({
          id: row.id as string,
          kind: row.kind as AiWriteProposal["kind"],
          resourceId: row.resourceId as string,
          content: row.content as string,
          createdAt: row.createdAt as string,
          status: row.status as AiWriteProposal["status"],
          sourceLinks: row.sourceLinks as string[],
        }),
      readBack: async () =>
        (await proposals.listAll()).map((p) =>
          defined({ id: p.id, kind: p.kind, resourceId: p.resourceId, content: p.content, createdAt: p.createdAt, status: p.status, sourceLinks: p.sourceLinks }),
        ),
    },
  };

  const repoFor = (kind: string): KindRepo => {
    const repo = Object.prototype.hasOwnProperty.call(repos, kind) ? repos[kind] : undefined;
    if (!repo) throw new Error(`unknown kind: ${kind}`);
    return repo;
  };

  return {
    kinds: Object.keys(repos),
    write: async (kind, row) => repoFor(kind).write(row),
    readBack: async (kind) => repoFor(kind).readBack(),
  };
}
