import type { Identifiable } from "../../../shared/repository.js";
import type { LogKind } from "../../logbook/domain/log-entry.js";
import type { MilestoneStatus } from "../../plan/domain/milestone.js";

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

export interface LabSnapshotContent {
  milestones: LabSnapshotMilestone[];
  logs: LabSnapshotLog[];
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
