import { SemanticScholarCitationSource } from "@/features/relations/infrastructure/semantic-scholar-citation-source";
import { createCredentialReader } from "../credentials";
import type { WireCitationsDeps } from "../wire-citations";
import type { CitationIntegrationManifest } from "./types";

export const semanticScholarCitationManifest: CitationIntegrationManifest = {
  id: "semantic-scholar",
  kind: "citation",
  userDescriptor: {
    providerId: "semantic-scholar",
    title: "Semantic Scholar",
    description: "Resolve paper metadata & citations",
    color: "#1857b6",
    runtimeGate: { kind: "citation", providerId: "semantic-scholar" },
    fields: [
      {
        id: "apiKey",
        label: "API key",
        type: "password",
        placeholder: "optional — raises rate limits",
      },
    ],
  },
  wire(deps: WireCitationsDeps) {
    const readCred = createCredentialReader(deps.manageSettings);
    return [
      new SemanticScholarCitationSource(
        undefined,
        "https://api.semanticscholar.org/graph/v1",
        () => readCred("semantic-scholar", "apiKey"),
      ),
    ];
  },
};
