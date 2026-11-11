/** Types for lab-snapshot. Its logic is in Rust (crates/wf-core, exposed by wf-wasm). */
import type { Identifiable } from "../../../shared/repository.js";
import type { LogKind } from "../../logbook/domain/log-entry.js";
import type { MilestoneStatus } from "../../plan/domain/milestone.js";
import type { ExperimentStatus } from "../../experiments/domain/experiment.js";
import type { ReportStatus } from "../../report/domain/report-section.js";

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

