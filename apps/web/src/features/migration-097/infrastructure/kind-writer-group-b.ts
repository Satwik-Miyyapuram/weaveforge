import type {
  AiWriteProposal,
  Experiment,
  LogEntry,
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
import { SERVER_ONLY_FIELDS } from "../domain/server-only-fields";
import { sinkAsWorkspaceFs } from "./sink-workspace-fs";

interface KindRepo {
  write(row: Row): Promise<void>;
  readBack(): Promise<Row[]>;
}

/** Drops undefined keys so absent optional fields stay absent in the row. */
function defined(row: Row): Row {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
}

/** The row minus the server-only columns of `kind`: what a file repo may store. */
function withoutServerOnly(kind: string, row: Row): Row {
  const skip = new Set(SERVER_ONLY_FIELDS[kind] ?? []);
  return Object.fromEntries(Object.entries(row).filter(([key]) => !skip.has(key)));
}

/**
 * True when the stored section already holds the DB row's content. Walks the DB row's keys only (not the
 * repo's read-back keys) and reads null and absent alike, because the file stores a null field as absent.
 * The repo's own updatedAt stamp is ignored.
 */
function sameExceptStamp(stored: ReportSection, row: ReportSection): boolean {
  const field = (s: ReportSection, k: string): string => JSON.stringify((s as unknown as Row)[k] ?? null);
  return Object.keys(row)
    .filter((k) => k !== "updatedAt")
    .every((k) => field(stored, k) === field(row, k));
}

const KIND_NAMES = ["logEntries", "milestones", "experiments", "metrics", "reportSections", "aiProposals"] as const;

/** Kinds stored once for the whole workspace, not per project folder. */
const WORKSPACE_KINDS: ReadonlySet<string> = new Set(["aiProposals"]);

/** The FILES repos of one project folder ("" = workspace root). */
function buildRepos(fs: ReturnType<typeof sinkAsWorkspaceFs>, projectRoot: string): Record<string, KindRepo> {
  const root = () => projectRoot;
  const logs = new FileLogEntryRepository(fs, root);
  const milestones = new FileMilestoneRepository(fs, projectRoot);
  const experiments = new FileExperimentRepository(fs, root);
  const metrics = new FileMetricRepository(fs, root);
  const sections = new FileReportSectionRepository(fs, root);
  const proposals = new FileAiProposalStore(fs);

  return {
    logEntries: {
      write: (row) => logs.save(withoutServerOnly("logEntries", row) as unknown as LogEntry),
      readBack: async () =>
        (await logs.list()).map((e) => defined({ ...e })),
    },
    milestones: {
      write: (row) => milestones.save(withoutServerOnly("milestones", row) as unknown as Milestone),
      readBack: async () =>
        (await milestones.list()).map((m) => defined({ ...m })),
    },
    experiments: {
      write: (row) => experiments.save(withoutServerOnly("experiments", row) as unknown as Experiment),
      readBack: async () => (await experiments.list()).map((e) => defined({ ...e })),
    },
    metrics: {
      write: async (row) => {
        const experimentId = row.experimentId as string;
        // Named here so an orphan point is reported with its own metric and step.
        if (!(await experiments.getById(experimentId))) {
          throw new Error(`metrics: orphan point ${row.metric as string} step ${row.step as number} has no experiment ${experimentId}`);
        }
        await metrics.append([
          {
            experimentId,
            metric: row.metric as string,
            step: row.step as number,
            value: row.value as number,
            wallTime: row.wallTime as string | undefined,
          } satisfies MetricPoint,
        ]);
      },
      readBack: async () => {
        const out: Row[] = [];
        for (const e of await experiments.list()) {
          for (const p of await metrics.history(e.id, undefined, { maxPoints: 0 })) {
            out.push(defined({ ...p }));
          }
        }
        return out;
      },
    },
    reportSections: {
      write: async (row) => {
        const want = withoutServerOnly("reportSections", row) as unknown as ReportSection;
        // The repo stamps a new updatedAt on every save, so an unchanged section is not saved again: a re-run keeps its bytes.
        const have = (await sections.list()).find((s) => s.id === want.id);
        if (have && sameExceptStamp(have, want)) return;
        await sections.save(want);
      },
      readBack: async () =>
        (await sections.list()).map((s) => defined({ ...s })),
    },
    aiProposals: {
      write: (row) => proposals.save(withoutServerOnly("aiProposals", row) as unknown as AiWriteProposal),
      readBack: async () =>
        (await proposals.listAll()).map((p) => defined({ ...p })),
    },
  };
}

/**
 * Group (b) kinds over the FILES repos, grouped by projectId. `roots` maps each
 * projectId to the folder its repos sit in ("" = workspace root); two projects
 * may not share a folder. A row whose project has no folder is refused.
 * Vault pages are handled elsewhere.
 */
export function createGroupBWriter(sink: FileSink, roots: ReadonlyMap<string, string>): KindWriter {
  const fs = sinkAsWorkspaceFs(sink);
  const seenFolders = new Map<string, string>();
  for (const [projectId, folder] of roots) {
    const other = seenFolders.get(folder);
    if (other !== undefined) throw new Error(`group b: projects ${other} and ${projectId} share folder '${folder}'`);
    seenFolders.set(folder, projectId);
  }
  const reposByFolder = new Map<string, Record<string, KindRepo>>();
  const reposFor = (folder: string): Record<string, KindRepo> => {
    let repos = reposByFolder.get(folder);
    if (!repos) {
      repos = buildRepos(fs, folder);
      reposByFolder.set(folder, repos);
    }
    return repos;
  };
  const checkKind = (kind: string): void => {
    if (!(KIND_NAMES as readonly string[]).includes(kind)) throw new Error(`unknown kind: ${kind}`);
  };

  return {
    kinds: [...KIND_NAMES],
    write: async (kind, row) => {
      checkKind(kind);
      const folder = roots.get(String(row.projectId));
      if (folder === undefined) throw new Error(`group b: no folder for project ${String(row.projectId)}`);
      return reposFor(folder)[kind]!.write(row);
    },
    readBack: async (kind) => {
      checkKind(kind);
      const out: Row[] = [];
      // Workspace-wide kinds have one store, not one per folder: read it once, so no row is listed twice.
      const folders = WORKSPACE_KINDS.has(kind) ? [""] : [...new Set(roots.values())];
      for (const folder of folders) {
        out.push(...(await reposFor(folder)[kind]!.readBack()));
      }
      return out;
    },
  };
}
