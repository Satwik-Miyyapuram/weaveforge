import type { AiResourceType, AiSourceLink, AiToolName } from "./ai-types.js";

export interface AiSourceExcerpt {
  source: AiSourceLink;
  text: string;
}

export interface AiReadRequest {
  resourceType: AiResourceType;
  resourceId: string;
  tool: AiToolName;
}

/** Reads already-decrypted, user-authorized content without knowing its storage backend. */
export interface IAiSourceReader {
  read(request: AiReadRequest): Promise<AiSourceExcerpt | null>;
}
