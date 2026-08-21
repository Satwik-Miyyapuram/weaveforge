"use client";

import type { VaultScreenData } from "@/features/vault/application/load-vault-screen.use-case";

export type VaultViewData = VaultScreenData & {
  ownerNames: Map<string, string>;
  /** Title/id pairs for `[[wikilink]]` resolution to papers. */
  paperEntries: { id: string; title: string }[];
  /** Title/id pairs for report section wikilinks. */
  sectionEntries: { id: string; title: string }[];
};
