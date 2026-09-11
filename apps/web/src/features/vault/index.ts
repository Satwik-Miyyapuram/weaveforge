export { VaultScreen } from "./ui/vault-screen";

/**
 * The rendered-markdown view of a note body, with wikilinks, embeds, callouts
 * and vault images resolved.
 *
 * Exported because it is not only this feature's presentation: the editor
 * workspace's Read mode is the same renderer, and a second feature may reach a
 * sibling only through its public API (CONTRIBUTING.md § SOLID). Reusing it is
 * the point — a second markdown renderer is how `/notes` and `/workspace` would
 * start disagreeing about what a callout or a wikilink looks like.
 */
export { VaultMarkdown, type WikilinkEntry } from "./ui/vault-markdown";
