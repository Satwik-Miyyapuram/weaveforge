import type { ShareableType } from "@thesis/core";

export interface SharedItem {
  id: string;
  kind: ShareableType;
  title: string;
  status: string;
  ownerId: string;
  /** Present for shared papers — used to render attached figures. */
  metadata?: Record<string, unknown>;
}

export interface ISharedReader {
  read(kind: ShareableType, ids: string[], owners: string[]): Promise<SharedItem[]>;
}
