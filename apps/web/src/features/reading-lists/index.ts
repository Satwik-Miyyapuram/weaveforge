/**
 * Public API of the reading-lists feature module (web half). Imported only
 * through this file — never from internal paths.
 */
export { readingListsModule } from "./module";
export { ListsScreen } from "./ui/lists-screen";
export { AddListForm } from "./ui/add-list-form";
export { LIST_COLOR_PRESETS, listDisplayColor, collectListIds } from "./ui/list-ui";
export {
  SupabaseReadingListRepository,
  SupabaseReadingListItemRepository,
} from "./infrastructure/supabase-reading-list-repository";
