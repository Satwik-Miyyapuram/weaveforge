/**
 * Public API of the papers feature module (web half). Other modules and the app
 * shell import from here only — never from internal paths.
 */
export { PapersScreen } from "./ui/papers-list";
/**
 * The paper note's read renderer and its image markdown, for the workspace
 * editor: a paper tab there stores images the way `/papers` does and renders
 * them the same way, rather than growing a second `paperimg:` resolver.
 */
export { PaperMarkdown } from "./ui/paper-markdown";
export { paperImageMarkdown } from "./lib/paper-images-md";
