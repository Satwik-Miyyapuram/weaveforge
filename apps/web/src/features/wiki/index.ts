/**
 * Public API of the wiki feature: concept-page drafting and wiki health.
 * Generated pages are ordinary vault notes, so there is no wiki storage here.
 */
export { wikiModule } from "./module";
export { WikiScreen } from "./ui/wiki-screen";
export {
  previewWikiBuild,
  proposeWikiPages,
  runWikiLint,
  WIKI_ROOT_TITLE,
} from "./application/build-wiki";
