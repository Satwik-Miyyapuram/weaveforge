/**
 * Lab snapshot content (Rust `lab_snapshot`), re-exported from index.ts. Keeps the
 * signature of packages/core/src/features/org/domain/lab-snapshot.ts.
 */
import {
  buildLabSnapshotContent as rawBuildLabSnapshotContent,
} from "../pkg/wf_wasm.js";
import type {
  ExperimentInput,
  LabSnapshotContent,
  LogEntryInput,
  MilestoneInput,
  ReportSectionInput,
} from "./bindings.js";

export {
  validateSnapshotTitle,
} from "../pkg/wf_wasm.js";

/** Freeze live records into snapshot content, keeping only what a supervisor reads. */
export function buildLabSnapshotContent(input: {
  milestones: MilestoneInput[];
  logs: LogEntryInput[];
  experiments: ExperimentInput[];
  report: ReportSectionInput[];
  aiAssisted?: number;
}): LabSnapshotContent {
  return rawBuildLabSnapshotContent(input) as LabSnapshotContent;
}

