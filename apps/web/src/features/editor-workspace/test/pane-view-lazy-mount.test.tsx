/**
 * A restored tab mounts its document the first time it is shown, not on open.
 *
 * Every tab of the last session used to mount its editor hidden, so opening
 * the workspace with a dozen tabs built a dozen editors before the first paint.
 */
import { before, test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { readyCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

before(loadTestCore);

test("only the shown tab of a restored pane mounts its document", async () => {
  const { PaneView } = await import("../ui/pane-view");
  const noop = () => {};
  let layout = readyCore().emptyLayout();
  for (const id of ["n1", "n2", "n3"]) layout = readyCore().openTab(layout, { kind: "note", id });
  const mounted: string[] = [];
  const html = renderToStaticMarkup(
    <PaneView
      focus={false}
      layout={layout}
      labelFor={() => "Note"}
      renderDocument={(tab) => {
        mounted.push(tab.id);
        return <i className="doc">{tab.id}</i>;
      }}
      onActivate={noop}
      onClose={noop}
      onFocus={noop}
      onSplit={noop}
      onDropTab={noop}
      onRatio={noop}
      onSetMode={noop}
      onTogglePreview={noop}
    />,
  );
  assert.deepEqual(mounted, ["n3"]);
  // The other tabs still hold their place, so showing one later mounts it there.
  assert.equal(html.match(/class="pane-document"/g)?.length, 3);
});
