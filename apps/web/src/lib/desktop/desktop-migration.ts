import type { DesktopMigration } from "@/features/migration-097/application/run-web-export";

/** The two shell calls the export needs, as the desktop bridge exposes them (both optional there). */
export type MigrationBridge = {
  migrate097Backup?: (folder: string) => Promise<{ deviceId: string; dumpPath: string }>;
  migrate097MarkExported?: (folder: string) => Promise<void>;
};

const NOT_AVAILABLE = "desktop migration not available: the shell bridge is missing this call";

/**
 * The export's desktop side, adapted from the bridge. The shell keeps the dump in the folder's migration dir
 * and answers its full `dumpPath`; report.json records the file name, which the shell's remove step resolves in
 * that dir. A missing bridge or call throws, so the export refuses rather than passing without a backup.
 */
export function desktopMigrationFromBridge(bridge: MigrationBridge | null): DesktopMigration {
  return {
    async backup(folder: string) {
      if (!bridge?.migrate097Backup) throw new Error(NOT_AVAILABLE);
      const { deviceId, dumpPath } = await bridge.migrate097Backup(folder);
      // report.json stores the dump NAME, never a path: the shell resolves it inside MIGRATION_DIR, and its
      // plain_backup_name refuses any name with a path separator.
      return { deviceId, dump: dumpPath.split(/[\\/]/).at(-1) ?? dumpPath };
    },
    async markExported(folder: string) {
      if (!bridge?.migrate097MarkExported) throw new Error(NOT_AVAILABLE);
      await bridge.migrate097MarkExported(folder);
    },
  };
}
