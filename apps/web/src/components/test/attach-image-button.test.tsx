/** The editor's image button names itself the same way to sight and to a screen reader (E30). */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AttachImageButton } from "../attach-image-button";

test("the image button's tooltip says what it does, the same words as its label (E30)", () => {
  const html = renderToStaticMarkup(<AttachImageButton editor={{ current: null }} onError={() => undefined} />);
  assert.match(html, /aria-label="Add image"/);
  assert.match(html, /title="Add image"/);
});
