/** Repository contract for shares (DIP). Grant is idempotent per
 * (owner, recipient, type, resource) — re-granting updates the access level. */

import type { NewShareInput, Share, ShareableType } from "./share.js";

export interface IShareRepository {
  /** Create or update a grant; returns the resulting share. */
  grant(input: NewShareInput): Promise<Share>;
  revoke(id: string): Promise<void>;
  /** Grants the signed-in user has made for one resource (null id = the blanket grant). */
  listForResource(resourceType: ShareableType, resourceId: string | null): Promise<Share[]>;
  /** Everything shared *with* the signed-in user, optionally filtered by type. */
  listSharedWithMe(resourceType?: ShareableType): Promise<Share[]>;
}
