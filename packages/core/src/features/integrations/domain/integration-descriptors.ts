/** UI-agnostic descriptor for a credential field on a user-scoped integration. */
export interface IntegrationFieldDescriptor {
  readonly id: string;
  readonly label: string;
  readonly type: "text" | "password";
  readonly placeholder?: string;
}

/**
 * Describes a per-user integration shown in Settings (API keys, library ids, …).
 * Implementations map `fields[].id` to stored credentials via {@link getUserIntegrationField}.
 */
export interface UserIntegrationDescriptor {
  readonly providerId: string;
  readonly title: string;
  readonly description: string;
  readonly color: string;
  readonly fields: readonly IntegrationFieldDescriptor[];
  /**
   * When set, the provider is only offered if the deployment wires that runtime port.
   * Example: bibliography provider "zotero" when `config.bibliography === "zotero"`.
   */
  readonly runtimeGate?: {
    readonly kind: "bibliography" | "citation";
    readonly providerId: string;
  };
}
