import type { DesktopMigration } from "@/features/migration-097/application/run-web-export";

/** The two shell calls the export needs, as the desktop bridge exposes them (both optional there). */
export type MigrationBridge = {
  migrate097Backup?: () => Promise<{ deviceId: string; dumpPath: string }>;
  migrate097MarkExported?: (folder: string) => Promise<void>;
};

const NOT_AVAILABLE = "desktop migration not available: the shell bridge is missing this call";

/**
 * The export's desktop side, adapted from the bridge. The shell takes no folder for the backup and names the
 * dump `dumpPath`; the engine's contract names it `dump`. A missing bridge or call throws, so the export refuses
 * rather than passing without a backup.
 */
export function desktopMigrationFromBridge(bridge: MigrationBridge | null): DesktopMigration {
  return {
    async backup() {
      if (!bridge?.migrate097Backup) throw new Error(NOT_AVAILABLE);
      const { deviceId, dumpPath } = await bridge.migrate097Backup();
      return { deviceId, dump: dumpPath };
    },
    async markExported(folder: string) {
      if (!bridge?.migrate097MarkExported) throw new Error(NOT_AVAILABLE);
      await bridge.migrate097MarkExported(folder);
    },
  };
}
