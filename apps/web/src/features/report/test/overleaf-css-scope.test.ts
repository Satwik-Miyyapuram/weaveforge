import assert from "node:assert/strict";
import { test } from "node:test";
import { scopeRoots } from "../../../../scripts/lib/overleaf-css-scope.mjs";

test("a :root rule styles the .ol-ide element itself", () => {
  assert.equal(scopeRoots(".ol-ide :root{--a:1}"), ".ol-ide{--a:1}");
});

test("a rule aimed at an overlay also matches the overlay tagged ol-ide", () => {
  assert.equal(scopeRoots(".ol-ide .modal .x{c:1}"), ".ol-ide .modal .x,.ol-ide.modal .x{c:1}");
  assert.equal(scopeRoots(".ol-ide .modal-content{c:1}"), ".ol-ide .modal-content{c:1}");
});

test("a theme rule keys off Overleaf's data-theme on body, an ancestor of .ol-ide", () => {
  assert.equal(scopeRoots(".ol-ide [data-theme=light]{--a:2}"), "body[data-theme=light] .ol-ide{--a:2}");
  assert.equal(
    scopeRoots(".ol-ide .a,.ol-ide :root [data-theme=default] .btn{c:1}"),
    ".ol-ide .a,body[data-theme=default] .ol-ide .btn{c:1}",
  );
});

test("a themed rule aimed at an overlay matches the tagged overlay too", () => {
  assert.equal(
    scopeRoots(".ol-ide [data-theme=default] .modal .y{c:1}"),
    "body[data-theme=default] .ol-ide .modal .y,body[data-theme=default] .ol-ide.modal .y{c:1}",
  );
});

test("data-theme deeper in a selector is left as written", () => {
  const css = ".ol-ide .uppy [data-theme=default] button{c:1}";
  assert.equal(scopeRoots(css), css);
});

test("an html or body rule styles the IDE's container, never an overlay tagged ol-ide", () => {
  const notOverlay = ":not(.modal,.modal-backdrop,.tooltip,.popover,.dropdown-menu,.context-menu)";
  assert.equal(scopeRoots(".ol-ide body{height:100%}"), `.ol-ide${notOverlay}{height:100%}`);
  assert.equal(scopeRoots(".ol-ide html,.ol-ide body{h:1}"), `.ol-ide${notOverlay},.ol-ide${notOverlay}{h:1}`);
  // Deeper selectors keep matching inside overlays, as before.
  assert.equal(scopeRoots(".ol-ide body .x{c:1}"), ".ol-ide .x{c:1}");
});
