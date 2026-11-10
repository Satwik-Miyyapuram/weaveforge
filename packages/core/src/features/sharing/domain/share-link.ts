/**
 * External share link domain (LINK_SHARE_PLAN.md).
 */

import type { ShareableType } from "./share.js";
import { rust } from "../../../shared/rust.js";

/** Default TTL for view links when the caller does not set `expiresAt`. */
export const SHARE_LINK_DEFAULT_TTL_DAYS = 7;

/** The default expiry of a new view link, `SHARE_LINK_DEFAULT_TTL_DAYS` after `nowMs`. */
export function defaultShareLinkExpiresAt(nowMs: number = Date.now()): string {
  return rust().defaultShareLinkExpiresAt(nowMs);
}

export interface ShareLink {
  id: string;
  ownerId: string;
  resourceType: ShareableType;
  resourceId: string;
  access: "view";
  expiresAt: string | null;
  createdAt: string;
}

export interface ShareLinkSaveInput {
  id: string;
  ownerId: string;
  resourceType: ShareableType;
  resourceId: string;
  access: "view";
  tokenHash: Uint8Array;
  expiresAt: string | null;
  dekWrap?: Uint8Array | null;
  dekEpoch?: number | null;
}

export interface ResolvedShareLink {
  id: string;
  ownerId: string;
  resourceType: ShareableType;
  resourceId: string;
  access: "view";
  dekWrap: Uint8Array | null;
  dekEpoch: number | null;
}

export interface IShareLinkRepository {
  getById(id: string): Promise<ShareLink | null>;
  listForResource(resourceType: ShareableType, resourceId: string): Promise<ShareLink[]>;
  save(input: ShareLinkSaveInput): Promise<ShareLink>;
  delete(id: string): Promise<void>;
  redeem(tokenHash: Uint8Array): Promise<ResolvedShareLink | null>;
}
