import { WorkspacePathError } from "@weaveforge/core";
import { loadCore } from "@/lib/rust-core";

/**
 * The Rust workspace path check. Refuses with `WorkspacePathError`, the error
 * every adapter has always thrown, so callers that catch it keep working.
 */
export async function safeWorkspacePath(path: string): Promise<string> {
  const core = await loadCore();
  try {
    return core.safeWorkspacePath(path);
  } catch {
    throw new WorkspacePathError(path);
  }
}
