import type { Integration, SyncProvider } from "@/features/sync/domain/integration";

/** Maps UI labels to {@link Integration} storage keys (`token` / `repo` / `branch`). */
export interface ProjectSyncFieldDescriptor {
  readonly key: keyof Pick<Integration, "token" | "repo" | "branch">;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder: string;
}

export interface ProjectSyncDescriptor {
  readonly id: string;
  readonly provider: SyncProvider;
  readonly title: string;
  readonly description: string;
  readonly color: string;
  readonly fields: readonly ProjectSyncFieldDescriptor[];
  readonly runtimeGate: {
    readonly kind: "notifications" | "logSync" | "gitRead";
    readonly providerId: string;
  };
}
