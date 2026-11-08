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
      {
        // OpenAlex is the fallback for related papers and title lookups; its
        // key shares this card so both paper-search keys sit together.
        id: "openAlexKey",
        label: "OpenAlex API key",
        type: "password",
        placeholder: "optional — raises OpenAlex's daily limit",
      },
    ],
  },
  wire(deps: WireCitationsDeps) {
    const readCred = createCredentialReader(deps.manageSettings);
    return [
      new SemanticScholarCitationSource(
        undefined,
        undefined,
        () => readCred("semantic-scholar", "apiKey"),
      ),
    ];
  },
};
