"use client";

import type { IAuthService, ManageSettingsUseCase } from "@thesis/core";
import { readBackendConfig } from "@/backend/config";
import { wireLightBackend } from "@/backend/wire-light-backend";

/** Dependencies needed before the privacy disclaimer is accepted. */
export interface LightContainer {
  settings: ManageSettingsUseCase;
  auth: IAuthService;
}

let lightContainer: LightContainer | null = null;
let lightCacheKey: string | null = null;

/**
 * Builds the pre-disclaimer container without repositories, integrations,
 * screen facades, AI, or collab. Full wiring lives in create-app-container.
 */
export function getLightContainer(): LightContainer {
  const config = readBackendConfig();
  const cacheKey = `${config.provider}:${config.supabaseUrl ?? config.databaseUrl ?? ""}`;
  if (lightContainer && lightCacheKey === cacheKey) return lightContainer;

  const backend = wireLightBackend(config);
  lightContainer = { settings: backend.manageSettings, auth: backend.auth };
  lightCacheKey = cacheKey;
  return lightContainer;
}
