import type { UserIntegrationDescriptor } from "@weaveforge/core";
import type { IntegrationConfig } from "./config";
import type { ProjectSyncDescriptor } from "./descriptors-types";

export type { ProjectSyncFieldDescriptor, ProjectSyncDescriptor } from "./descriptors-types";
export {
  userIntegrationsForConfig,
  projectSyncDescriptorsForConfig,
  sharedProviderHint,
} from "./descriptors-resolve";
