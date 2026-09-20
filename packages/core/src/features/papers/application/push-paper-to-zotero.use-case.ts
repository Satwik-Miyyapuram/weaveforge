import type { IBibliographyIntegration } from "../../integrations/domain/integration-ports.js";
import type { Paper } from "../domain/paper.js";
import type { IPaperRepository } from "../domain/paper-repository.js";

/**
 * What came of trying to put a paper into the user's bibliography manager.
 *
 * An outcome rather than a boolean, and rather than a throw, because "already
 * there" and "Zotero was unreachable" are different situations that a caller may
 * reasonably treat differently — and because the two copies of this rule that
 * preceded it disagreed about the failure in a way nobody had decided: one
 * wrapped the push in a `try`/`catch` and returned nothing, the other let the
 * error propagate out of a *confirmed* AI proposal, after the paper had already
 * been added.
 */
export type ZoteroPushOutcome = "pushed" | "already-linked" | "failed";

/**
 * Push a paper to the bibliography provider and remember the remote key.
 *
 * One rule, in core, because both dependencies are already core ports: the paper
 * repository to read the key and store it back, and the bibliography
 * integration to push. The rule was written twice — once in the papers facade's
 * `autoPush`, once as a callback in the composition root — and the copies had
 * already drifted.
 *
 * Best-effort by design. A paper with no item behind it in Zotero is a valid
 * state, not an error, so a library that refuses the push must not fail the
 * write that already happened: for the AI path the paper is added first, and
 * reporting "the proposal failed" after adding it would be the worst of both
 * answers. Failures are *reported* through the outcome instead of silently
 * swallowed, which is the part the facade's copy got wrong.
 */
export class PushPaperToZoteroUseCase {
  constructor(
    private readonly deps: {
      papers: Pick<IPaperRepository, "save">;
      bibliography: Pick<IBibliographyIntegration, "pushPaper">;
    },
  ) {}

  async execute(paper: Paper): Promise<ZoteroPushOutcome> {
    // A stored key means this row already has an item behind it — pushed
    // earlier, or pulled from the library — and pushing again would duplicate it.
    if (paper.metadata?.zoteroKey) return "already-linked";

    let key: string | undefined;
    try {
      key = await this.deps.bibliography.pushPaper(paper);
    } catch {
      return "failed";
    }
    // The provider refuses a paper it cannot identify by returning nothing,
    // which is not an error either.
    if (!key) return "failed";

    await this.deps.papers.save({
      ...paper,
      metadata: { ...paper.metadata, zoteroKey: key },
    });
    return "pushed";
  }
}
