/** Public API of the experiments feature module (web half). */
export { ExperimentsScreen } from "./ui/experiments-screen";
/**
 * Where a run opens, for features that link to one.
 *
 * Through the barrel rather than the file: `check:solid` forbids reaching into
 * another feature's `ui/`, and it is right to — the graph wanting a run's URL
 * should not also acquire the right to depend on `experiment-href`'s internals
 * or to be broken by that file moving.
 */
export { experimentHref } from "./ui/experiment-href";
