/**
 * Encrypted CRDT update persistence (migration 0042).
 */

export interface CrdtUpdateRecord {
  id: number;
  resourceType: string;
  resourceId: string;
  projectId: string | null;
  epoch: number;
  payload: Uint8Array;
  authorId: string;
  createdAt: string;
}

export interface ICrdtUpdateStore {
  append(input: {
    resourceType: string;
    resourceId: string;
    projectId: string | null;
    epoch: number;
    payload: Uint8Array;
    authorId: string;
  }): Promise<CrdtUpdateRecord>;
  listAfter(resourceType: string, resourceId: string, afterId?: number): Promise<CrdtUpdateRecord[]>;
  deleteUpTo(resourceType: string, resourceId: string, uptoId: number): Promise<void>;
  deleteAll(resourceType: string, resourceId: string): Promise<void>;
  countAfter(resourceType: string, resourceId: string, afterId?: number): Promise<number>;
}
