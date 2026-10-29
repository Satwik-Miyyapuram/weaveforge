/**
 * The shared Table (design D15, DA-131, R4.6): one scroll box so a wide table
 * scrolls inside itself, the styled table with its sticky head, and one
 * full-width row that says so when there is nothing to show.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Table } from "../table";

const head = (
  <>
    <th>Name</th>
    {["a", "b"].map((k) => (
      <th key={k}>{k}</th>
    ))}
  </>
);

test("rows sit in the styled table inside its own scroll box", () => {
  const out = renderToStaticMarkup(
    <Table head={head} empty="Nothing yet." label="Runs">
      <tr>
        <td>one</td>
        <td>1</td>
        <td>2</td>
      </tr>
    </Table>,
  );
  assert.match(out, /^<div class="table-scroll"><table class="cmp-table" aria-label="Runs"><thead><tr><th>Name<\/th><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>one<\/td>/);
  assert.doesNotMatch(out, /Nothing yet/);
});

test("with no rows, one row spans every column and says why", () => {
  const out = renderToStaticMarkup(
    <Table head={head} empty="Nothing yet.">
      {[].map(() => null)}
    </Table>,
  );
  assert.match(out, /<tbody><tr class="table-empty"><td colSpan="3">Nothing yet\.<\/td><\/tr><\/tbody>/);
});

test("extra classes join the shared ones", () => {
  const out = renderToStaticMarkup(
    <Table head={head} empty="-" className="papers-table" scrollClassName="papers-table-scroll">
      {null}
    </Table>,
  );
  assert.match(out, /<div class="table-scroll papers-table-scroll"><table class="cmp-table papers-table">/);
});
