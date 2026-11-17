import {
  createTokenAuthenticator,
  createTombstoneRecorder,
  handleWorkspaceServerDataDelete,
} from "../../../../../server/workspace-server-data";

export const dynamic = "force-dynamic";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const config = {
    authUrl: requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    dataUrl: requiredEnv("NEXT_PUBLIC_DATA_URL"),
    anonKey: requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  };
  return handleWorkspaceServerDataDelete(request, id, {
    authenticate: createTokenAuthenticator(config),
    recordTombstone: createTombstoneRecorder(config),
  });
}
