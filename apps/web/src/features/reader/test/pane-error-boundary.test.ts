import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaneErrorBoundary } from "../ui/pane-error-boundary";
import { paneErrorReport } from "../ui/pane-error-report";

function boundary(label = "Reader") {
  const b = new PaneErrorBoundary({ label, children: null });
  // Stand-in for React's updater: merge the patch straight into state.
  (b as unknown as { setState: (patch: object) => void }).setState = (patch) => {
    Object.assign(b.state, patch);
  };
  return b;
}

test("a render error is kept in state so the fallback shows", () => {
  const error = new Error("Failed to construct 'URL': Invalid URL");
  assert.deepEqual(PaneErrorBoundary.getDerivedStateFromError(error), { error });
});

test("the fallback offers Try again", () => {
  const b = boundary();
  b.state = { error: new Error("boom") };
  const html = renderToStaticMarkup(b.render() as Parameters<typeof renderToStaticMarkup>[0]);
  assert.match(html, /Reader could not be shown/);
  assert.match(html, />Try again</);
});

test("Try again clears the error so the pane renders its children again", () => {
  const b = boundary();
  b.state = { error: new Error("boom") };
  b.retry();
  assert.equal(b.state.error, null);
});

test("componentDidCatch reports the label, the error and the component stack", () => {
  const error = new Error("boom");
  const report = paneErrorReport("Reader", error, "\n    at PaperPdfPane");
  assert.equal(report.level, "error");
  assert.equal(report.source, "screen");
  assert.match(report.message, /Reader could not be shown/);
  assert.match(report.detail ?? "", /boom/);
  assert.match(report.detail ?? "", /at PaperPdfPane/);
});
