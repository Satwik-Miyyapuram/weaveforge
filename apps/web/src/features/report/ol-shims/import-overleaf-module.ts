// Runtime stand-in for Overleaf's babel macro (frontend/macros), which lists
// the optional add-on modules a build includes. We ship none, so every call
// gets an empty list, as in an Overleaf build with no modules. next.config.mjs
// swaps the macro for this file.
export default function importOverleafModules(_name: string): any[] {
  return []
}
