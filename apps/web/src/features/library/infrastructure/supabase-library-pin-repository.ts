import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ICurrentUserProvider,
  ILibraryPinRepository,
  LibraryPin,
  NewLibraryPinInput,
  ShareableType,
} from "@thesis/core";
import type { ProjectContext } from "@/lib/project-context";

interface PinRow {
  id: string;
  user_id: string;
  project_id: string;
  resource_type: ShareableType;
  resource_id: string;
  owner_id: string;
  created_at: string;
}

const TABLE = "library_pins";

export class SupabaseLibraryPinRepository implements ILibraryPinRepository {
  constructor(
    private readonly db: SupabaseClient,
    private readonly ctx: ProjectContext,
    private readonly session: ICurrentUserProvider,
  ) {}

  private get projectId() {
    const id = this.ctx.projectId;
    if (!id) throw new Error("Select a project before pinning items.");
    return id;
  }

  async pin(input: NewLibraryPinInput): Promise<LibraryPin> {
    const userId = await this.session.requireUserId();
    const { data, error } = await this.db
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          project_id: this.projectId,
          resource_type: input.resourceType,
          resource_id: input.resourceId,
          owner_id: input.ownerId,
        },
        { onConflict: "user_id,project_id,resource_type,resource_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return toDomain(data as PinRow);
  }

  async unpin(resourceType: ShareableType, resourceId: string): Promise<void> {
    const { error } = await this.db
      .from(TABLE)
      .delete()
      .eq("project_id", this.projectId)
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId);
    if (error) throw error;
  }

  async listForProject(): Promise<LibraryPin[]> {
    const projectId = this.ctx.projectId;
    if (!projectId) return [];
    const { data, error } = await this.db
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as PinRow[]).map(toDomain);
  }

  async isPinned(resourceType: ShareableType, resourceId: string): Promise<boolean> {
    const projectId = this.ctx.projectId;
    if (!projectId) return false;
    const { count, error } = await this.db
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("resource_type", resourceType)
      .eq("resource_id", resourceId);
    if (error) throw error;
    return (count ?? 0) > 0;
  }
}

function toDomain(row: PinRow): LibraryPin {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}
