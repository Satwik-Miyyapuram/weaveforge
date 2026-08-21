/**
 * Public API of the reading-lists feature module (web half). Imported only
 * through this file — never from internal paths.
 */
export { ListsScreen } from "./ui/lists-screen";
export { listDisplayColor } from "./ui/list-ui";
export {
  SupabaseReadingListRepository,
  SupabaseReadingListItemRepository,
} from "./infrastructure/supabase-reading-list-repository";
