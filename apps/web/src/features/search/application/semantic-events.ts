/**
 * Fired when the semantic arm attaches or detaches, so open views can re-query.
 * Its own module so a view can listen without loading the engine that fires it.
 */
export const SEMANTIC_CHANGED_EVENT = "weaveforge:semantic-changed";
