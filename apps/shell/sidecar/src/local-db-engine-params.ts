// Default 128MB cache is ~8x the database and costs ~120 MB of main memory.
export const LOCAL_DB_SHARED_BUFFERS = "32MB";

export function engineStartParams(defaults: readonly string[]): string[] {
  return [...defaults, "-c", `shared_buffers=${LOCAL_DB_SHARED_BUFFERS}`];
}
