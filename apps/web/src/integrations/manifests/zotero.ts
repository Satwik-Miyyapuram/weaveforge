import { wireZoteroBibliography } from "../providers/zotero/wire-zotero-bibliography";
import type { WireIntegrationsDeps } from "../wire-integrations";
import type { BibliographyIntegrationManifest } from "./types";

export const zoteroBibliographyManifest: BibliographyIntegrationManifest = {
  id: "zotero",
  kind: "bibliography",
  userDescriptor: {
    providerId: "zotero",
    title: "Zotero",
    description: "Two-way paper & annotation sync",
    color: "#cc2936",
    runtimeGate: { kind: "bibliography", providerId: "zotero" },
    fields: [
      {
        id: "apiKey",
        label: "API key",
        type: "password",
        placeholder: "from zotero.org/settings/keys",
      },
      {
        id: "library",
        label: "Library",
        type: "text",
        placeholder: "users/123456 or groups/789",
      },
    ],
  },
  wire(deps: WireIntegrationsDeps) {
    const zotero = wireZoteroBibliography({
      ...deps,
      projectCollection: deps.projectBibliographyCollection,
    });
    return {
      integration: zotero.integration,
      metadataSource: zotero.metadataSource,
      projectCollection: zotero.projectCollection,
    };
  },
};
