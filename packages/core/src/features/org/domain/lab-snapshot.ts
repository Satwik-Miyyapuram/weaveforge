import type { Identifiable } from "../../../shared/repository.js";
import type { LogKind } from "../../logbook/domain/log-entry.js";
import type { MilestoneStatus } from "../../plan/domain/milestone.js";
import type { Experiment, ExperimentStatus } from "../../experiments/domain/experiment.js";
import type { ReportSection, ReportStatus } from "../../report/domain/report-section.js";
import type { LogEntry } from "../../logbook/domain/log-entry.js";
import type { Milestone } from "../../plan/domain/milestone.js";

/** Frozen milestone fields included in a lab snapshot payload. */
export interface LabSnapshotMilestone {
  id: string;
  title: string;
  description?: string;
  status: MilestoneStatus;
  targetDate?: string;
}

/** Frozen log entry fields included in a lab snapshot payload. */
export interface LabSnapshotLog {
  id: string;
  entryDate: string;
  kind: LogKind;
  body: string;
}

/** Frozen experiment fields included in a lab snapshot payload. */
export interface LabSnapshotExperiment {
  id: string;
  name: string;
  status: ExperimentStatus;
  resultNote?: string;
}

/** Frozen report section progress included in a lab snapshot payload. */
export interface LabSnapshotReportSection {
  id: string;
  title: string;
  status: ReportStatus;
  wordCount: number;
}

/** Snapshots published before experiments, report and AI counts existed lack those fields. */
export interface LabSnapshotContent {
  milestones: LabSnapshotMilestone[];
  logs: LabSnapshotLog[];
  experiments?: LabSnapshotExperiment[];
  report?: LabSnapshotReportSection[];
  /** AI suggestions the student accepted in this project. */
  aiAssisted?: number;
}

/** A published freeze of a project's plan + logbook for supervisor review. */
export interface LabSnapshot extends Identifiable {
  id: string;
  projectId: string;
  title: string;
  note?: string;
  content: LabSnapshotContent;
  publishedAt: string;
  createdAt: string;
}

export interface PublishLabSnapshotInput {
  title: string;
  note?: string;
  content: LabSnapshotContent;
}

/** Freeze live records into snapshot content, keeping only what a supervisor reads. */
export function buildLabSnapshotContent(input: {
  milestones: Milestone[];
  logs: LogEntry[];
  experiments: Experiment[];
  report: ReportSection[];
  aiAssisted?: number;
}): LabSnapshotContent {
  return {
    milestones: input.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      status: m.status,
      targetDate: m.targetDate,
    })),
    logs: input.logs.map((l) => ({ id: l.id, entryDate: l.entryDate, kind: l.kind, body: l.body })),
    experiments: input.experiments.map((e) => ({
      id: e.id,
      name: e.name,
      status: e.status,
      resultNote: e.resultNote,
    })),
    report: input.report.map((r) => ({ id: r.id, title: r.title, status: r.status, wordCount: r.wordCount })),
    ...(input.aiAssisted === undefined ? {} : { aiAssisted: input.aiAssisted }),
  };
}
