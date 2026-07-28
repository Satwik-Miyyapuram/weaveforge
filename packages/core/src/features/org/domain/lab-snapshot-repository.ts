import type { LabSnapshot, PublishLabSnapshotInput } from "./lab-snapshot.js";

export interface ILabSnapshotRepository {
  publish(input: PublishLabSnapshotInput): Promise<LabSnapshot>;
  remove(id: string): Promise<void>;
  listMine(): Promise<LabSnapshot[]>;
  /** Snapshots owned by `memberId` (supervisor read via RLS). */
  listForMember(memberId: string): Promise<LabSnapshot[]>;
  getById(id: string): Promise<LabSnapshot | null>;
}
