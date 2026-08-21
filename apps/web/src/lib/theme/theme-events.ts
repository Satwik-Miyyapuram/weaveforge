/**
 * The name of the event fired whenever the theme, mode or motion setting
 * changes on the document.
 *
 * A leaf module holding one string. It used to live in `use-theme`, which
 * imports the persistence layer and from there the whole app container — so
 * anything that only wanted to *listen* for a theme change pulled Supabase in
 * behind it. The statically exported pitch site needs the listener and none of
 * that.
 */
export const THEME_CHANGE_EVENT = "thesis-theme-change";
