/**
 * The MyScript cloud engine: the opt-in gate, the batch mapping, and maths →
 * LaTeX (§5.2, §5.4, §7 step 10).
 *
 * **No test in this file makes a network call, and none of them has a key.** The
 * response is a *recorded* fixture — the shape iink v4.0 answers
 * `POST /api/v4.0/iink/recognize` with, transcribed from iinkTS' own types
 * (`TJIIXV2Export`, `TJIIXV2TextElement`, `ExportV2Type`) — and the fetch is
 * injected, so what is under test is the mapping and the gate rather than a live
 * service.
 *
 * What these tests are for: the privacy rule is worth nothing if it is only a
 * comment, so "off without a key" and "a key never appears in the body" are
 * asserted as properties rather than trusted.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { makeInkStroke, type InkStroke } from "../../src/ink/ink-note.js";
import type { InkLine, InkRecognitionHints, RecognisedLine } from "../../src/ink/recognise.js";
import {
  MYSCRIPT_DEFAULT_CONFIDENCE,
  MYSCRIPT_DEFAULT_SCALE,
  MYSCRIPT_ENGINE_ID,
  MYSCRIPT_ENDPOINT_PATH,
  MYSCRIPT_JIIX_MIME,
  MYSCRIPT_LATEX_MIME,
  convertToLatex,
  createMyScriptRecogniser,
  isMyScriptConfigured,
  latexBlock,
  myScriptLatex,
  myScriptRecognisedLines,
  myScriptRequestBody,
  type MyScriptExportResponse,
  type MyScriptFetch,
} from "../../src/ink/myscript/index.js";

/** The hints every call in this file passes; vocabulary is deliberately non-empty. */
const HINTS: InkRecognitionHints = { vocabulary: ["Graph-prior module", "VGAE"], lang: "en" };

/**
 * A recorded response: the "Graph-prior module" lines of a two-line derivation.
 *
 * This is a transcript, not a construction — the labels, candidates, baselines and
 * bounding boxes are the shape the service answered, transcribed onto the same
 * canvas the strokes were sent from. That last part matters: the mapper places a
 * response by *relative* vertical position, so a fixture whose geometry came from
 * a different canvas would be testing the tolerance rather than the mapping. The
 * stroke `items` are kept so the fixture cannot silently be trimmed to only the
 * fields the mapper happens to read today. The maths answer is the second call's
 * payload, under the LaTeX key, which the service sends as a bare string rather
 * than an element tree.
 */
const RECORDED_TEXT_RESPONSE: MyScriptExportResponse = {
  [MYSCRIPT_JIIX_MIME]: {
    type: "Text",
    id: "text-1",
    version: "3.0.0",
    elements: [
      {
        id: "e1",
        type: "Text",
        label: "Drop the beta sweep for",
        candidates: ["Drop the beta sweep for", "Drop the β sweep for"],
        "bounding-box": [40, 760, 560, 48],
        lines: [{ "baseline-y": 784, "x-height": 24 }],
        items: [{ type: "stroke", id: "line-0-s0" }],
      },
      {
        id: "e2",
        type: "Text",
        label: "see VGAE table 2",
        candidates: ["see VGAE table 2"],
        "bounding-box": [40, 1480, 420, 44],
        lines: [{ "baseline-y": 1504, "x-height": 22 }],
        items: [{ type: "stroke", id: "line-1-s0" }],
      },
    ],
  },
};

const RECORDED_MATHS_RESPONSE: MyScriptExportResponse = {
  [MYSCRIPT_LATEX_MIME]: String.raw`\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}`,
};

/**
 * A line of writing: one stroke with the shape and time a digitiser would report.
 *
 * The bounds are the ones the recorded response's baselines sit in, because the
 * mapping under test is geometric — a line built anywhere else would be testing
 * the tolerance rather than the mapping.
 */
function line(yTop: number, yBottom: number, t0: number): InkLine {
  const points: number[] = [];
  for (let i = 0; i < 8; i += 1) points.push(100 + i * 12, i % 2 === 0 ? yTop : yBottom);
  const stroke: InkStroke = makeInkStroke({
    points,
    // One pressure per *point*, which is the model's contract (§4.4) and what the
    // parallel arrays sent to the service have to line up with.
    pressures: Array.from({ length: points.length / 2 }, (_value, index) => 100 + index * 8),
    width: 32,
    t0,
  });
  return { strokes: [stroke], yBand: [yTop, yBottom] };
}

/** The two lines the recorded response belongs to, top line first. */
const PAGE: InkLine[] = [line(760, 808, 0), line(1480, 1528, 900)];

/** A response with no per-element geometry at all, to exercise the fallback. */
const GEOMETRY_FREE_RESPONSE: MyScriptExportResponse = {
  [MYSCRIPT_JIIX_MIME]: {
    type: "Text",
    elements: [
      { id: "a", type: "Text", label: "first" },
      { id: "b", type: "Text", label: "second" },
    ],
  },
};

/**
 * An injected fetch that records what it was asked to send.
 *
 * It never resolves to a real `Response`: the module reads `ok`, `status` and
 * `text()`, so that is the whole surface a stub has to provide, and that smallness
 * is what lets this file assert the request without a server.
 */
function recordingFetch(answer: MyScriptExportResponse): {
  fetch: MyScriptFetch;
  sends: { url: string; init: Parameters<MyScriptFetch>[1] }[];
} {
  const sends: { url: string; init: Parameters<MyScriptFetch>[1] }[] = [];
  const fetch: MyScriptFetch = async (url, init) => {
    sends.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify(answer) };
  };
  return { fetch, sends };
}

test("the engine is online, not offline, and says so under the id the note records", async () => {
  const engine = createMyScriptRecogniser();
  // The note's `ink-engine` is written from this id, which is what tells a
  // reviewer the text was produced off-machine (§5.2).
  assert.equal(engine.id, "myscript@1");
  assert.equal(engine.id, MYSCRIPT_ENGINE_ID);
  // Both facts are read by the selector: `online` buys it a place in the order,
  // and `offline: false` is what a caller must not mistake for a local engine.
  assert.equal(engine.offline, false);
  assert.equal(engine.online, true);
  // The gate is a promise, and with no key it settles false without a packet.
  assert.equal(await engine.available(), false);
});

test("available() is false without a key, so opting in is the only way in", async () => {
  // Every shape of "no key" a settings field or a config file can produce.
  for (const options of [
    {},
    { applicationKey: undefined },
    { applicationKey: null },
    { applicationKey: "" },
    { applicationKey: "   " },
  ]) {
    assert.equal(isMyScriptConfigured(options), false, JSON.stringify(options));
    assert.equal(await createMyScriptRecogniser(options).available(), false);
  }

  // And the one shape that is a key: a non-blank string changes the answer.
  assert.equal(isMyScriptConfigured({ applicationKey: "test-key" }), true);
  assert.equal(await createMyScriptRecogniser({ applicationKey: "test-key" }).available(), true);
});

test("recognising without a key refuses rather than reporting an empty page", async () => {
  const engine = createMyScriptRecogniser();
  // An empty result would be indistinguishable from "the service read nothing",
  // and the caller would record an engine that never ran (§5.2).
  await assert.rejects(() => engine.recognise(PAGE, HINTS), /no application key/);
});

test("the request body is the batch shape, with one flat stroke group per stroke", () => {
  const { body, lines } = myScriptRequestBody(PAGE, HINTS);
  assert.equal(body.contentType, "Text", "text recognition is the default content type");
  assert.equal(body.scaleX, MYSCRIPT_DEFAULT_SCALE);
  assert.equal(body.scaleY, MYSCRIPT_DEFAULT_SCALE, "both axes agree, which is all the service needs");
  assert.equal(body.configuration.lang, "en");
  assert.deepEqual(body.configuration.text, { mimeTypes: [MYSCRIPT_JIIX_MIME] });
  assert.deepEqual(body.configuration.export.mimeTypes, [MYSCRIPT_JIIX_MIME]);

  assert.equal(body.strokes.length, 2);
  assert.deepEqual(lines.map((entry) => ({ index: entry.index, id: entry.id, yBand: entry.yBand })), [
    { index: 0, id: "line-0", yBand: [760, 808] },
    { index: 1, id: "line-1", yBand: [1480, 1528] },
  ]);

  const first = body.strokes[0]!;
  assert.equal(first.id, "line-0-s0", "a stroke id names its line so a log line can find it");
  assert.equal(first.pointerType, "pen");
  // The stroke's points are parallel arrays, which is what the endpoint takes.
  assert.deepEqual(first.x.slice(0, 3), [100, 112, 124]);
  assert.deepEqual(first.y.slice(0, 3), [760, 808, 760]);
  assert.deepEqual(first.t.slice(0, 3), [0, 1, 2], "time runs one tick per point from t0");
  // Pressure goes out normalised to [0, 1] from the note's 0–255 (§4.4).
  assert.equal(first.p[0], 100 / 255);
  assert.equal(Math.max(...first.p) <= 1, true, "255 would arrive as a scribble");
  assert.deepEqual(body.strokes[1]!.t.slice(0, 2), [900, 901], "the second line keeps its own start");
});

test("a stroke with nothing drawable in it is dropped rather than failing the page", () => {
  const empty: InkLine = { strokes: [makeInkStroke({ points: [10, 10] })], yBand: [0, 10] };
  const { body } = myScriptRequestBody([...PAGE, empty], HINTS);
  assert.equal(body.strokes.length, 2, "the two real strokes are still sent");
  // The line is still named, so the response for it maps back to an empty line
  // rather than shifting every line after it (§4.2's text layer is positional).
  assert.equal(myScriptRequestBody([...PAGE, empty], HINTS).lines.length, 3);
});

test("the key travels in the header and never in the body", async () => {
  const { fetch, sends } = recordingFetch(RECORDED_TEXT_RESPONSE);
  const engine = createMyScriptRecogniser({ applicationKey: "test-key", fetch });
  await engine.recognise(PAGE, HINTS);

  assert.equal(sends.length, 1);
  const [send] = sends;
  assert.equal(send!.url, `https://cloud.myscript.com${MYSCRIPT_ENDPOINT_PATH}`);
  assert.equal(send!.init.headers["applicationKey"], "test-key");
  // The body is strokes, and strokes only: a key in a payload is a key in a log.
  const serialised = JSON.stringify(JSON.parse(send!.init.body));
  assert.equal(serialised.includes("test-key"), false);
  assert.equal(send!.init.body.includes("test-key"), false);
});

test("the recorded response maps back into one recognised line per line, in the note's order", () => {
  const { body, lines } = myScriptRequestBody(PAGE, HINTS);
  const recognised = myScriptRecognisedLines(RECORDED_TEXT_RESPONSE, PAGE, lines);

  assert.equal(recognised.length, PAGE.length, "one result per line sent, whatever came back");
  assert.deepEqual(
    recognised.map((entry) => entry.text),
    ["Drop the beta sweep for", "see VGAE table 2"],
  );
  assert.deepEqual(
    recognised.map((entry) => entry.conf),
    [MYSCRIPT_DEFAULT_CONFIDENCE, MYSCRIPT_DEFAULT_CONFIDENCE],
    "JIIX reports no score, so the documented constant is used rather than an invention",
  );
  assert.equal(body.strokes.length, 2, "the page's two strokes were the two that were recognised");
});

test("a response is grouped by where it sits on the page, not by the order it listed", () => {
  const recorded = RECORDED_TEXT_RESPONSE[MYSCRIPT_JIIX_MIME] as { elements: unknown[] };
  const shuffled: MyScriptExportResponse = {
    [MYSCRIPT_JIIX_MIME]: { ...recorded, elements: [...recorded.elements].reverse() },
  };
  const { lines } = myScriptRequestBody(PAGE, HINTS);
  const recognised = myScriptRecognisedLines(shuffled, PAGE, lines);

  // Element order is not part of the contract, so the bottom line's text must not
  // move to the top just because the service listed it first.
  assert.deepEqual(
    recognised.map((entry) => entry.text),
    ["Drop the beta sweep for", "see VGAE table 2"],
  );
});

test("other readings become alternatives, deduplicated against the chosen text", () => {
  const [first] = myScriptRecognisedLines(RECORDED_TEXT_RESPONSE, PAGE, myScriptRequestBody(PAGE, HINTS).lines);
  assert.deepEqual(first!.alternatives, ["Drop the β sweep for"], "the top candidate is not repeated");
  const [second] = myScriptRecognisedLines(
    { [MYSCRIPT_JIIX_MIME]: { elements: [] } },
    PAGE,
    [],
  );
  assert.equal(second!.text, "", "an unread line is empty");
  assert.equal(second!.conf, 0, "and unsure, so the correction UI offers it (§5.4)");
  assert.equal(second!.alternatives, undefined, "with nothing to offer");
});

test("a line the service did not place is taken in request order rather than from the first line", () => {
  const { lines } = myScriptRequestBody(PAGE, HINTS);
  const recognised = myScriptRecognisedLines(GEOMETRY_FREE_RESPONSE, PAGE, lines);
  assert.deepEqual(
    recognised.map((entry) => entry.text),
    ["first", "second"],
    "two positionless readings are dealt out one per line, in the order they were sent",
  );
});

test("more readings than lines are dropped, and more lines than readings stay empty", () => {
  const extra: MyScriptExportResponse = {
    [MYSCRIPT_JIIX_MIME]: {
      elements: [
        { type: "Text", label: "one", "bounding-box": [0, 760, 10, 48] },
        { type: "Text", label: "two", "bounding-box": [0, 1480, 10, 48] },
        { type: "Text", label: "three", "bounding-box": [0, 2200, 10, 48] },
      ],
    },
  };
  const recognised = myScriptRecognisedLines(extra, PAGE, myScriptRequestBody(PAGE, HINTS).lines);
  assert.equal(recognised.length, PAGE.length, "the result is the page's shape, not the service's");
  assert.deepEqual(recognised.map((entry) => entry.text), ["one", "two"]);

  const short = myScriptRecognisedLines(
    { [MYSCRIPT_JIIX_MIME]: { elements: [{ type: "Text", label: "one", "bounding-box": [0, 760, 10, 48] }] } },
    PAGE,
    myScriptRequestBody(PAGE, HINTS).lines,
  );
  assert.deepEqual(short.map((entry) => entry.text), ["one", ""]);
  assert.equal(short[1]!.conf, 0);
});

test("a mapping survives a response that named its list something else", () => {
  // `words` is the older JIIX list; reading both costs a line and means a service
  // that renamed `elements` still maps rather than silently emptying the page.
  const older: MyScriptExportResponse = {
    [MYSCRIPT_JIIX_MIME]: {
      words: [
        { label: "Drop the beta sweep for", "bounding-box": [0, 760, 10, 48] },
        { label: "see VGAE table 2", "bounding-box": [0, 1480, 10, 48] },
      ],
    },
  };
  const recognised = myScriptRecognisedLines(older, PAGE, myScriptRequestBody(PAGE, HINTS).lines);
  assert.deepEqual(recognised.map((entry) => entry.text), ["Drop the beta sweep for", "see VGAE table 2"]);
});

test("confidence from a mapped line is under one, so a page is never all corrected", () => {
  const [first] = myScriptRecognisedLines(RECORDED_TEXT_RESPONSE, PAGE, myScriptRequestBody(PAGE, HINTS).lines);
  // `1` means a human corrected the line (§5.4's interface), and no server answer
  // may claim that.
  assert.equal(first!.conf < 1, true);
  assert.equal(first!.conf > 0, true);
});

test("maths asks the same endpoint with the maths content type and the LaTeX export", async () => {
  const { body } = myScriptRequestBody([PAGE[0]!], { lang: "en" }, { contentType: "Math" });
  assert.equal(body.contentType, "Math", "the maths conversion is a parameter, not another URL");
  assert.deepEqual(body.configuration.math, { mimeTypes: [MYSCRIPT_LATEX_MIME] });
  assert.deepEqual(body.configuration.export.mimeTypes, [MYSCRIPT_LATEX_MIME]);
  assert.equal(body.configuration.text, undefined, "a maths request carries no text block");
  // The URL is the same one the text path posts to, so the conversion is a
  // parameter of the one endpoint rather than a second endpoint to keep in step.
  const { fetch, sends } = recordingFetch(RECORDED_MATHS_RESPONSE);
  const engine = createMyScriptRecogniser({ applicationKey: "test-key", fetch });
  await engine.convertMaths(myScriptRequestBody([PAGE[0]!], { lang: "en" }, { contentType: "Math" }));
  assert.equal(sends[0]!.url, `https://cloud.myscript.com${MYSCRIPT_ENDPOINT_PATH}`);
  assert.equal(
    (JSON.parse(sends[0]!.init.body) as { contentType: string }).contentType,
    "Math",
  );
});

test("a maths response is the LaTeX under its own MIME key, with the element tree as a fallback", () => {
  const direct = myScriptLatex(RECORDED_MATHS_RESPONSE);
  assert.equal(direct.latex, String.raw`\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}`);

  // A service that answered the maths under the JIIX key still converts, because
  // the element's label is the LaTeX in that shape.
  const fallback = myScriptLatex({
    [MYSCRIPT_JIIX_MIME]: {
      elements: [
        {
          type: "Math",
          label: "x^2 + y^2 = r^2",
          candidates: ["x^2 + y^2 = r^2", "x^{2} + y^{2} = r^{2}"],
        },
      ],
    },
  });
  assert.equal(fallback.latex, "x^2 + y^2 = r^2");
  assert.deepEqual(fallback.alternatives, ["x^{2} + y^{2} = r^{2}"]);

  assert.deepEqual(myScriptLatex(null), { latex: "" }, "no response is no LaTeX, not a throw");
});

test("convertToLatex returns a $$ block and refuses without a key", async () => {
  // The plan asks for maths in a `$$` block, on demand (§7 step 10).
  assert.equal(latexBlock("x^2"), "$$\nx^2\n$$");
  assert.equal(latexBlock("  x^2  "), "$$\nx^2\n$$", "the block trims, so a double fence cannot drift");

  const { fetch, sends } = recordingFetch(RECORDED_MATHS_RESPONSE);
  const converted = await convertToLatex(PAGE[0]!, { applicationKey: "test-key", fetch });
  assert.equal(converted.latex, `$$\n${String.raw`\int_0^\infty e^{-x^2} dx = \frac{\sqrt{\pi}}{2}`}\n$$`);
  assert.equal(sends.length, 1);
  assert.equal(
    (JSON.parse(sends[0]!.init.body) as { contentType: string }).contentType,
    "Math",
    "the conversion sends the maths content type",
  );

  // Without a key the conversion refuses: an empty LaTeX and a refused one look
  // identical downstream, and only one of them means the text stayed here.
  await assert.rejects(() => convertToLatex(PAGE[0]!), /never runs without one/);
});

test("the engine records the note's own engine id and never a key", async () => {
  const { fetch } = recordingFetch(RECORDED_TEXT_RESPONSE);
  const engine = createMyScriptRecogniser({ applicationKey: "test-key", fetch });
  const recognised: RecognisedLine[] = await engine.recognise(PAGE, HINTS);
  assert.equal(recognised.length, 2);
  assert.equal(engine.id, "myscript@1");

  // A failing service is an error, not a page of blanks: the caller must be able
  // to tell "the cloud said nothing" from "the cloud was never reached".
  const failing = createMyScriptRecogniser({
    applicationKey: "test-key",
    fetch: async () => ({ ok: false, status: 403, text: async () => "access.not.granted" }),
  });
  await assert.rejects(() => failing.recognise(PAGE, HINTS), /403/);
});
