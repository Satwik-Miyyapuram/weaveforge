import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "@/components/markdown/markdown";
import { resolveVaultImageSource } from "@/lib/hooks/use-vault-markdown-source";
import { readyCore } from "@/lib/rust-core";

const PATH = "u1/p1/cat.png";
const PREFIX = readyCore().vaultImagePrefix();

test("a canvas text node shows a vault: picture as an img at its resolved URL", () => {
  const source = `Look ![cat](${PREFIX}${PATH}) here`;
  const resolved = resolveVaultImageSource(source, [PATH], new Map([[PATH, "blob:http://x/1"]]));
  const markup = renderToStaticMarkup(<Markdown>{resolved}</Markdown>);
  assert.match(markup, /<img[^>]+src="blob:http:\/\/x\/1"/);
  assert.doesNotMatch(markup, /vault:/);
});

test("a vault: picture that has not loaded yet is dropped, not left as a broken img", () => {
  const source = `Look ![cat](${PREFIX}${PATH}) here`;
  const resolved = resolveVaultImageSource(source, [PATH], new Map());
  const markup = renderToStaticMarkup(<Markdown>{resolved}</Markdown>);
  assert.doesNotMatch(markup, /<img/);
  assert.doesNotMatch(markup, /vault:/);
});

test("a plain text node without vault: pictures is passed through unchanged", () => {
  const source = "Plain **text** with [a link](https://example.org) and a line.";
  assert.equal(resolveVaultImageSource(source, [], new Map()), source);
});
