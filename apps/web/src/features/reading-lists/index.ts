/**
 * Public API of the reading-lists feature module (web half). Imported only
 * through this file — never from internal paths.
 */
export { ListsScreen } from "./ui/lists-screen";
export { listDisplayColor } from "./ui/list-ui";
/**
 * File a paper or a note into a list, from the item itself.
 *
 * There was an `AddToListDialog` here too — a modal that did the same job and
 * predated the flyout. Nothing had imported it since "Add to list" became a
 * submenu of the card's ⋯ menu, so it was deleted rather than left as a second,
 * unreachable answer to the question this picker answers.
 */
export { ListPicker, type PickerTarget } from "./ui/list-picker";
