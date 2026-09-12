/**
 * The WebGL2 ink renderer: one instanced pass of SDF capsules, and a stencil for
 * the highlighter.
 *
 * The whole of §6.2.3 and §11.1's first three rules, in the order the plan gives
 * them:
 *
 * 1. **One instanced pass, SDF capsules, analytic caps, joins and AA.** A quad
 *    enclosing each segment, inflated by the nib plus `INK_AA_MARGIN_PX`; the
 *    fragment shader computes the distance to the segment and smoothsteps it. No
 *    join discs to z-fight, no notch geometry, no vertex soup — 295 000 segments
 *    upload as 5.9 MB and draw in one call per colour.
 * 2. **The highlighter goes through the hardware stencil buffer**, never an
 *    offscreen target: `EQUAL 0` / `INCR` with multiply blending straight to the
 *    backbuffer. The first fragment on a pixel passes and sets the bit; every later
 *    overlapping fragment is rejected by fixed-function hardware *before* the
 *    fragment shader runs. That replaces a full-resolution RGBA target (~22 MB at
 *    2880 × 1920) plus a full-screen composite per frame with one stencil clear.
 *    Global dedupe is deliberate: two crossing highlighter strokes do **not**
 *    darken where they cross.
 * 3. **Draw incrementally.** The live stroke's new segments are appended to a
 *    dynamic buffer with `bufferSubData` at the growing end, so a frame costs the
 *    new geometry and not the whole stroke (measured 0.5 ms against 4.8 ms).
 *
 * What is deliberately *not* here: a second renderer. That is `canvas-renderer.ts`
 * (step 6), behind the same interface, for a context loss or a driver without
 * WebGL2.
 *
 * **A note on the taper.** A segment with two different radii is a cone, and this
 * shader interpolates the radius along the segment (`mix(rA, rB, t)`) rather than
 * evaluating the exact round-cone distance field. The difference is sub-pixel for
 * the taper handwriting produces — a few hundredths of a millimetre between
 * consecutive samples — and the exact form costs three more square roots per
 * fragment. If a profile ever shows the seam, the exact SDF is a drop-in change to
 * one line of the shader.
 */

import type { InkColour } from "@weaveforge/core";

import type { InkStrokeGeometry } from "../application/page-buffer";
import {
  INK_AA_MARGIN_PX,
  INK_INSTANCE_FLOATS,
  INK_SEGMENT_SUBDIVISIONS,
  packStrokeInstances,
  strokeInstanceCount,
  usesHighlighterPass,
  type InkBackend,
  type InkLiveStroke,
  type InkRenderStats,
  type InkRenderer,
  type InkViewTransform,
  type InkBackgroundImage,
} from "./ink-renderer";

/**
 * The palette the shader can draw. Indices match `INK_COLOURS`, and the values are
 * the light-theme sRGB tokens' equivalents.
 *
 * Colours are passed as data far enough into the pipeline that a theme change does
 * not need a shader rebuild, but they are *here* rather than read from CSS because
 * the worker has no document: a `getComputedStyle` call in a worker is not
 * available, and the palette is six values that change with the app's theme, which
 * the host re-posts rather than the renderer discovering.
 */
export const INK_RENDER_COLOURS: Record<InkColour, [number, number, number]> = {
  text: [0.13, 0.14, 0.16],
  accent: [0.23, 0.42, 0.86],
  warn: [0.85, 0.55, 0.09],
  good: [0.16, 0.6, 0.36],
  info: [0.2, 0.55, 0.72],
  danger: [0.79, 0.24, 0.24],
};

/** The palette's order, so a stroke's colour name becomes a shader index. */
const PALETTE: readonly InkColour[] = [
  "text",
  "accent",
  "warn",
  "good",
  "info",
  "danger",
];

export const VERTEX_SHADER = `#version 300 es
in vec2 corner;          // unit quad: (0,-1) (1,-1) (1,1) (0,-1) (1,1) (0,1)
in vec4 seg;             // A.xy, B.xy in page units
in vec2 radius;          // rA, rB in page units, per instance
uniform vec2 pageSize;   // device pixels, for normalising
uniform vec4 camera;     // scale, offsetX, offsetY, unused
uniform float margin;    // the AA margin in page units
out vec2 vPage;
out vec2 vA;
out vec2 vB;
out vec2 vRadius;
out float vMargin;
void main() {
  vec2 a = seg.xy;
  vec2 b = seg.zw;
  vMargin = margin;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  // Not "half": a reserved word in GLSL ES, which ANGLE on Direct3D rejects.
  float extent = max(radius.x, radius.y) + margin;
  // The quad covers the segment plus the nib and the AA margin, on every side:
  // across it for the body, and *past both ends* for the caps. Without the
  // end extension the quad stops flat at A and B, so a stroke's ends are
  // squared off and the outside of every bend has a wedge no instance covers,
  // which shows as a speckle of pinholes along a curve.
  vec2 along = dir * (len * corner.x + extent * (2.0 * corner.x - 1.0));
  vec2 across = normal * extent * corner.y;
  vec2 page = a + along + across;
  vPage = page;
  vA = a;
  vB = b;
  vRadius = radius;
  // Page units → clip space. Y is flipped: page y grows downward, clip y upward.
  vec2 scaled = (page + vec2(camera.y, camera.z)) * camera.x;
  vec2 unit = scaled / pageSize;
  gl_Position = vec4(unit.x * 2.0 - 1.0, 1.0 - unit.y * 2.0, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vPage;
in vec2 vA;
in vec2 vB;
in vec2 vRadius;
in float vMargin;
uniform vec4 inkColour;   // rgb + alpha
uniform float feather;    // AA width in page units
out vec4 outColour;
void main() {
  vec2 pa = vPage - vA;
  vec2 ba = vB - vA;
  // A degenerate segment — a dot — has no direction to project onto. Guarding the
  // division is what makes the plan's "zero-length segment renders a round dot"
  // true rather than a NaN.
  float denom = max(dot(ba, ba), 0.0001);
  float t = clamp(dot(pa, ba) / denom, 0.0, 1.0);
  float d = length(pa - ba * t);
  float r = mix(vRadius.x, vRadius.y, t);
  float fw = max(fwidth(d), feather);
  float alpha = 1.0 - smoothstep(r - fw, r + fw, d);
  if (alpha <= 0.0) discard;
  outColour = vec4(inkColour.rgb, inkColour.a * alpha);
}`;

const CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

/** One colour's geometry, resident in its own buffers so a draw is one call. */
interface Batch {
  colour: InkColour;
  highlighter: boolean;
  /** Instance floats: `INK_INSTANCE_FLOATS` per segment. */
  data: Float32Array;
  /** Segment records, one per stroke, for erase. */
  records: { stroke: number; offset: number; count: number }[];
  /** The GL buffer and how much of it is in use. */
  buffer: WebGLBuffer | null;
  capacity: number;
  used: number;
}

/** An offscreen render target for export, with its own depth-stencil attachment. */
interface CaptureTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthStencil: WebGLRenderbuffer | null;
  width: number;
  height: number;
}
/**
 * The background pass: the page image as one textured quad over the page rect,
 * through the same camera as the strokes. `corner` is the stroke quad's unit
 * geometry reused — x in [0,1], y in [-1,1] — mapped onto the page.
 */
export const BACKGROUND_VERTEX_SHADER = `#version 300 es
in vec2 corner;
uniform vec2 pageSize;   // device pixels
uniform vec4 camera;     // scale, offsetX, offsetY, unused
uniform vec2 pageDims;   // page width and height in page units
out vec2 vUv;
void main() {
  vec2 uv = vec2(corner.x, (corner.y + 1.0) * 0.5);
  vUv = uv;
  vec2 page = uv * pageDims;
  vec2 scaled = (page + vec2(camera.y, camera.z)) * camera.x;
  vec2 unit = scaled / pageSize;
  gl_Position = vec4(unit.x * 2.0 - 1.0, 1.0 - unit.y * 2.0, 0.0, 1.0);
}`;

export const BACKGROUND_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D image;
out vec4 outColour;
void main() {
  outColour = texture(image, vUv);
}`;

export interface WebglInkRendererOptions {
  canvas: OffscreenCanvas | HTMLCanvasElement;
  /** The path the delegated trail is on, which decides `desynchronized` (§6.2.6). */
  delegating?: boolean;
  /** Called when the context is lost, and again when it comes back. */
  onContextLifecycle?: (state: "lost" | "restored") => void;
}

/**
 * The WebGL2 renderer.
 *
 * Context attributes are chosen by path and set at creation, because they are
 * immutable afterwards and the first `getContext` wins silently (§6.2.8):
 *
 * - delegated path — `{ alpha: false, antialias: false, stencil: true, desynchronized: false }`
 * - fallback path — the same with `desynchronized: true`
 *
 * `antialias: false` because the SDF does its own AA and MSAA on 295 000 inflated
 * quads would pay for coverage the shader already computes. `stencil: true` because
 * the highlighter needs it. If the path can change at runtime — a presenter that
 * appears late — the canvas has to be recreated rather than the attribute flipped,
 * which is the host's decision and not this class's.
 */
export class WebglInkRenderer implements InkRenderer {
  readonly backend: InkBackend = "webgl2";

  private readonly canvas: OffscreenCanvas | HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly cornerBuffer: WebGLBuffer;
  private readonly pageSizeUniform: WebGLUniformLocation | null;
  private readonly cameraUniform: WebGLUniformLocation | null;
  private readonly colourUniform: WebGLUniformLocation | null;
  private readonly featherUniform: WebGLUniformLocation | null;
  /** The quad's inflation, in page units — the overdraw lever (§11.3.9). */
  private readonly marginUniform: WebGLUniformLocation | null;
  private readonly backgroundProgram: WebGLProgram;
  private readonly backgroundPageSizeUniform: WebGLUniformLocation | null;
  private readonly backgroundCameraUniform: WebGLUniformLocation | null;
  private readonly backgroundDimsUniform: WebGLUniformLocation | null;
  private readonly backgroundImageUniform: WebGLUniformLocation | null;
  private background: InkBackgroundImage | null = null;
  private backgroundTexture: WebGLTexture | null = null;
  private readonly batches = new Map<string, Batch>();
  private readonly onLifecycle:
    ((state: "lost" | "restored") => void) | undefined;

  private width = 1;
  /** The buffer index the next appended stroke gets, absent an explicit one. */
  private nextStroke = 0;
  private height = 1;
  private dpr = 1;
  private pageWidth = 2100;
  private pageHeight = 2970;
  private transform: InkViewTransform = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    devicePixelRatio: 1,
  };
  private live: InkLiveStroke | null = null;
  private livePacked = 0;
  private liveBatch: Batch | null = null;
  private target: CaptureTarget | null = null;
  private lost = false;
  private stats: InkRenderStats = {
    backend: "webgl2",
    strokes: 0,
    segments: 0,
    drawn: 0,
    marginPx: INK_AA_MARGIN_PX,
  };

  constructor(options: WebglInkRendererOptions) {
    this.canvas = options.canvas;
    this.onLifecycle = options.onContextLifecycle;
    const attributes: WebGLContextAttributes = {
      alpha: false,
      antialias: false,
      stencil: true,
      desynchronized: !options.delegating,
      preserveDrawingBuffer: false,
      premultipliedAlpha: false,
    };
    const gl = options.canvas.getContext(
      "webgl2",
      attributes,
    ) as WebGL2RenderingContext | null;
    if (!gl) throw new Error("ink: WebGL2 is not available");
    this.gl = gl;

    this.program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    this.pageSizeUniform = gl.getUniformLocation(this.program, "pageSize");
    this.cameraUniform = gl.getUniformLocation(this.program, "camera");
    this.colourUniform = gl.getUniformLocation(this.program, "inkColour");
    this.featherUniform = gl.getUniformLocation(this.program, "feather");
    this.marginUniform = gl.getUniformLocation(this.program, "margin");

    this.backgroundProgram = linkProgram(
      gl,
      BACKGROUND_VERTEX_SHADER,
      BACKGROUND_FRAGMENT_SHADER,
    );
    this.backgroundPageSizeUniform = gl.getUniformLocation(
      this.backgroundProgram,
      "pageSize",
    );
    this.backgroundCameraUniform = gl.getUniformLocation(
      this.backgroundProgram,
      "camera",
    );
    this.backgroundDimsUniform = gl.getUniformLocation(
      this.backgroundProgram,
      "pageDims",
    );
    this.backgroundImageUniform = gl.getUniformLocation(
      this.backgroundProgram,
      "image",
    );

    const corner = gl.createBuffer();
    if (!corner) throw new Error("ink: could not create the quad buffer");
    this.cornerBuffer = corner;
    gl.bindBuffer(gl.ARRAY_BUFFER, corner);
    gl.bufferData(gl.ARRAY_BUFFER, CORNERS, gl.STATIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(1, 1, 1, 1);

    // Context loss is the main new failure mode of putting ink on the GPU on
    // integrated graphics (§6.2.9). All state is reconstructible from the sidecar
    // and the page buffer, so recovery is "re-upload", and the host is told so it
    // can fall back to Canvas 2D while the context is gone.
    options.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
      this.onLifecycle?.("lost");
    });
    options.canvas.addEventListener("webglcontextrestored", () => {
      this.lost = false;
      this.uploadAll();
      this.onLifecycle?.("restored");
    });
  }

  /** What the renderer is doing, for a status bar or a perf gate. */
  get renderStats(): InkRenderStats {
    return { ...this.stats };
  }

  setPage(size: { width: number; height: number }, _paper: string): void {
    this.pageWidth = Math.max(1, size.width);
    this.pageHeight = Math.max(1, size.height);
  }

  setBackground(image: InkBackgroundImage | null): void {
    this.background = image;
    this.uploadBackground();
  }

  setTransform(transform: InkViewTransform): void {
    this.transform = transform;
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    this.width = Math.max(1, Math.round(cssWidth * devicePixelRatio));
    this.height = Math.max(1, Math.round(cssHeight * devicePixelRatio));
    this.dpr = devicePixelRatio;
    if (this.canvas.width !== this.width) this.canvas.width = this.width;
    if (this.canvas.height !== this.height) this.canvas.height = this.height;
    this.gl.viewport(0, 0, this.width, this.height);
  }

  setStrokes(strokes: readonly (InkStrokeGeometry | null)[]): void {
    this.clearBatches();
    this.nextStroke = 0;
    strokes.forEach((stroke, index) => {
      if (stroke) this.appendStroke(stroke, index);
    });
    this.nextStroke = strokes.length;
  }

  appendStroke(stroke: InkStrokeGeometry, index = this.nextStroke): void {
    this.nextStroke = index + 1;
    const batch = this.batchFor(
      stroke.colour,
      usesHighlighterPass(stroke.tool),
    );
    const segments = strokeInstanceCount(
      Math.min(stroke.x.length, stroke.y.length),
    );
    if (segments === 0) return;
    const offset = batch.used;
    this.ensureBatchCapacity(batch, offset + segments);
    const written = packStrokeInstances(
      {
        x: stroke.x,
        y: stroke.y,
        pressure: stroke.pressure,
        width: stroke.width,
        variableWidth: !usesHighlighterPass(stroke.tool),
      },
      batch.data.subarray(offset * INK_INSTANCE_FLOATS),
    );
    if (written === 0) return;
    batch.records.push({ stroke: index, offset, count: segments });
    batch.used = offset + segments;
    this.uploadBatch(batch, offset, segments);
  }

  removeStroke(index: number): void {
    for (const batch of this.batches.values()) {
      const at = batch.records.findIndex((record) => record.stroke === index);
      if (at < 0) continue;
      const removed = batch.records[at]!;
      const last = batch.records[batch.records.length - 1]!;
      if (last !== removed) {
        // Swap the last record into the hole: the GPU range moves, nothing is
        // re-packed, and the buffer is edited in place (§6.2.3's "erase is a
        // buffer edit, not a repaint").
        const from = last.offset * INK_INSTANCE_FLOATS;
        const to = removed.offset * INK_INSTANCE_FLOATS;
        const length = last.count * INK_INSTANCE_FLOATS;
        batch.data.copyWithin(to, from, from + length);
        batch.records[at] = { ...last, offset: removed.offset };
        this.uploadBatch(batch, removed.offset, last.count);
      }
      batch.records.pop();
      batch.used -= removed.count;
      // The vacated tail is left as it is: `used` is what the draw reads, so the
      // stale instances beyond it are never drawn and the next append overwrites
      // them.
      return;
    }
  }

  setLive(stroke: InkLiveStroke | null): void {
    if (!stroke) {
      this.live = null;
      this.liveBatch = null;
      this.livePacked = 0;
      return;
    }
    const colour = stroke.header.colour;
    const batch = this.batchFor(
      colour,
      usesHighlighterPass(stroke.header.tool),
      true,
    );
    const points = Math.min(stroke.x.length, stroke.y.length);
    const segments = Math.max(0, points - 1);
    if (this.live !== stroke || batch !== this.liveBatch) {
      // A new stroke: nothing to carry over.
      this.livePacked = 0;
      batch.used = 0;
      batch.records = [];
    }
    this.live = stroke;
    this.liveBatch = batch;
    this.ensureBatchCapacity(batch, strokeInstanceCount(points));
    // Re-pack from one segment before the newest: the sample that just landed
    // sets the tangent the previous segment curves with, and a predicted tail
    // that was replaced rather than extended changes the last few outright.
    this.livePacked = Math.max(0, Math.min(this.livePacked, segments) - 1);
    const from = this.livePacked * INK_SEGMENT_SUBDIVISIONS;
    const written = packStrokeInstances(
      {
        x: stroke.x,
        y: stroke.y,
        pressure: stroke.pressure,
        width: stroke.header.width,
        variableWidth: !usesHighlighterPass(stroke.header.tool),
      },
      batch.data.subarray(from * INK_INSTANCE_FLOATS),
      { from: this.livePacked },
    );
    if (written > 0) {
      const count = written / INK_INSTANCE_FLOATS;
      this.uploadBatch(batch, from, count);
      this.livePacked += count / INK_SEGMENT_SUBDIVISIONS;
    }
    batch.used = this.livePacked * INK_SEGMENT_SUBDIVISIONS;
  }

  draw(): void {
    const gl = this.gl;
    if (this.lost) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.clearColor(1, 1, 1, 1);
    // The stencil is cleared every frame, not just when the highlighter is used:
    // a stale bit would silently refuse the first highlighter fragment of the next
    // frame, which is a stroke that draws in patches.
    gl.clearStencil(0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

    this.drawBackground();

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    const cornerLocation = gl.getAttribLocation(this.program, "corner");
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(this.pageSizeUniform, this.width, this.height);
    gl.uniform4f(
      this.cameraUniform,
      this.transform.scale * this.dpr,
      this.transform.offsetX,
      this.transform.offsetY,
      0,
    );
    // The AA margin and the feather are the same quantity in two places: the quad
    // is inflated by it (so the fragment shader has pixels to antialias into) and
    // `smoothstep` covers it. One pixel of device space, converted to page units,
    // which is the plan's lever on overdraw (§11.3.9) — inflate generously and
    // every segment overlaps its neighbours.
    const marginPageUnits =
      INK_AA_MARGIN_PX / Math.max(this.transform.scale * this.dpr, 0.0001);
    gl.uniform1f(this.marginUniform, marginPageUnits);
    gl.uniform1f(this.featherUniform, marginPageUnits);

    let drawn = 0;
    let segments = 0;

    // Opaque strokes first, straight to the target.
    for (const batch of this.batches.values()) {
      if (batch.highlighter || batch.used === 0) continue;
      drawn += this.drawBatch(batch);
      segments += batch.used;
    }

    // Then the highlighter, deduped through the stencil: the first fragment on a
    // pixel passes and sets the bit, every later overlapping fragment is rejected
    // by fixed-function hardware before the shader runs. Multiply blending, because
    // a highlighter darkens what is under it rather than covering it.
    const highlighter = [...this.batches.values()].filter(
      (batch) => batch.highlighter && batch.used > 0,
    );
    if (highlighter.length > 0) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.EQUAL, 0, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
      gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      for (const batch of highlighter) {
        drawn += this.drawBatch(batch, 0.35);
        segments += batch.used;
      }
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.STENCIL_TEST);
    }

    this.stats = {
      backend: "webgl2",
      strokes: this.batches.size,
      segments,
      drawn,
      marginPx: INK_AA_MARGIN_PX,
    };
  }

  async capture(scale: number): Promise<Blob | null> {
    const gl = this.gl;
    if (this.lost) return null;
    const width = Math.max(1, Math.round(this.pageWidth * scale));
    const height = Math.max(1, Math.round(this.pageHeight * scale));
    const wasTransform = this.transform;
    const wasWidth = this.width;
    const wasHeight = this.height;

    const pixels = new Uint8Array(width * height * 4);
    try {
      const target = this.ensureTarget(width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.clearColor(1, 1, 1, 1);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      // The page, drawn 1:1 into its own pixels.
      this.transform = { scale, offsetX: 0, offsetY: 0, devicePixelRatio: 1 };
      this.width = width;
      this.height = height;
      this.draw();
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    } finally {
      this.transform = wasTransform;
      this.width = wasWidth;
      this.height = wasHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      // An A4 page at 2× is ~100 MB of texture and stencil; an export is rare
      // and the next one can allocate again. Kept only for as long as it is
      // being read.
      this.releaseTarget();
    }

    // A fresh canvas that is *never drawn to again*: the readback rule (§6.2.8) is
    // about Canvas 2D surfaces being drawn to, and this one only ever receives.
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) return null;
    const image = context.createImageData(width, height);
    // WebGL's origin is bottom-left and the image's is top-left.
    for (let row = 0; row < height; row += 1) {
      const from = (height - row - 1) * width * 4;
      image.data.set(pixels.subarray(from, from + width * 4), row * width * 4);
    }
    context.putImageData(image, 0, 0);
    return canvas.convertToBlob({ type: "image/png" });
  }

  dispose(): void {
    const gl = this.gl;
    for (const batch of this.batches.values()) {
      if (batch.buffer) gl.deleteBuffer(batch.buffer);
    }
    this.batches.clear();
    this.releaseTarget();
    if (this.backgroundTexture) gl.deleteTexture(this.backgroundTexture);
    this.backgroundTexture = null;
    this.background = null;
    gl.deleteBuffer(this.cornerBuffer);
    gl.deleteProgram(this.program);
    gl.deleteProgram(this.backgroundProgram);
  }

  /** The page image under the strokes: one quad, page rect, same camera. */
  private drawBackground(): void {
    const gl = this.gl;
    if (!this.backgroundTexture) return;
    gl.useProgram(this.backgroundProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    const cornerLocation = gl.getAttribLocation(
      this.backgroundProgram,
      "corner",
    );
    gl.enableVertexAttribArray(cornerLocation);
    gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(this.backgroundPageSizeUniform, this.width, this.height);
    gl.uniform4f(
      this.backgroundCameraUniform,
      this.transform.scale * this.dpr,
      this.transform.offsetX,
      this.transform.offsetY,
      0,
    );
    gl.uniform2f(this.backgroundDimsUniform, this.pageWidth, this.pageHeight);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.backgroundTexture);
    gl.uniform1i(this.backgroundImageUniform, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  /** (Re)upload the kept image as the background texture; also after a restore. */
  private uploadBackground(): void {
    const gl = this.gl;
    if (this.lost) return;
    if (this.backgroundTexture) {
      gl.deleteTexture(this.backgroundTexture);
      this.backgroundTexture = null;
    }
    if (!this.background) return;
    const texture = gl.createTexture();
    if (!texture) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      this.background,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    this.backgroundTexture = texture;
  }

  /* ----------------------------------------------------------------------- */

  /** The batch a colour and pass belong to. */
  private batchFor(
    colour: InkColour,
    highlighter: boolean,
    live = false,
  ): Batch {
    const key = `${live ? "live:" : ""}${highlighter ? "hl" : "pen"}:${colour}`;
    const existing = this.batches.get(key);
    if (existing) return existing;
    const batch: Batch = {
      colour,
      highlighter,
      data: new Float32Array(INK_INSTANCE_FLOATS * 512),
      records: [],
      buffer: this.gl.createBuffer(),
      capacity: 512,
      used: 0,
    };
    this.batches.set(key, batch);
    return batch;
  }

  private clearBatches(): void {
    for (const [key, batch] of [...this.batches.entries()]) {
      if (key.startsWith("live:")) continue;
      batch.records = [];
      batch.used = 0;
    }
  }

  /** Grow a batch's CPU-side array to hold `segments`, doubling as it goes. */
  private ensureBatchCapacity(batch: Batch, segments: number): void {
    if (segments <= batch.capacity) return;
    let capacity = batch.capacity;
    while (capacity < segments) capacity *= 2;
    const grown = new Float32Array(capacity * INK_INSTANCE_FLOATS);
    grown.set(batch.data);
    batch.data = grown;
    batch.capacity = capacity;
  }

  /** Push one range of a batch to the GPU. */
  private uploadBatch(batch: Batch, offset: number, count: number): void {
    const gl = this.gl;
    if (!batch.buffer || count <= 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    const required = batch.capacity * INK_INSTANCE_FLOATS * 4;
    const current = gl.getBufferParameter(
      gl.ARRAY_BUFFER,
      gl.BUFFER_SIZE,
    ) as number;
    if (!current || current < required) {
      // Grow the GPU buffer: the whole array goes up once, and every later upload
      // is a `bufferSubData` of the new segments.
      gl.bufferData(gl.ARRAY_BUFFER, batch.data, gl.DYNAMIC_DRAW);
      return;
    }
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      offset * INK_INSTANCE_FLOATS * 4,
      batch.data.subarray(
        offset * INK_INSTANCE_FLOATS,
        (offset + count) * INK_INSTANCE_FLOATS,
      ),
    );
  }

  /** One instanced draw call for a batch, and the instances it covered. */
  private drawBatch(batch: Batch, alphaOverride?: number): number {
    const gl = this.gl;
    if (!batch.buffer || batch.used === 0) return 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    const segmentLocation = gl.getAttribLocation(this.program, "seg");
    gl.enableVertexAttribArray(segmentLocation);
    gl.vertexAttribPointer(
      segmentLocation,
      4,
      gl.FLOAT,
      false,
      INK_INSTANCE_FLOATS * 4,
      0,
    );
    gl.vertexAttribDivisor(segmentLocation, 1);
    const radiusLocation = gl.getAttribLocation(this.program, "radius");
    gl.enableVertexAttribArray(radiusLocation);
    gl.vertexAttribPointer(
      radiusLocation,
      2,
      gl.FLOAT,
      false,
      INK_INSTANCE_FLOATS * 4,
      16,
    );
    gl.vertexAttribDivisor(radiusLocation, 1);

    const rgb = INK_RENDER_COLOURS[batch.colour] ?? INK_RENDER_COLOURS.text;
    const alpha = alphaOverride ?? (batch.highlighter ? 0.35 : 1);
    gl.uniform4f(this.colourUniform, rgb[0], rgb[1], rgb[2], alpha);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, batch.used);
    return batch.used;
  }

  /** The offscreen target export renders into, reused between exports. */
  private releaseTarget(): void {
    if (!this.target) return;
    const gl = this.gl;
    gl.deleteFramebuffer(this.target.framebuffer);
    gl.deleteTexture(this.target.texture);
    if (this.target.depthStencil)
      gl.deleteRenderbuffer(this.target.depthStencil);
    this.target = null;
  }

  private ensureTarget(width: number, height: number): CaptureTarget {
    const gl = this.gl;
    if (
      this.target &&
      this.target.width === width &&
      this.target.height === height
    )
      return this.target;
    if (this.target) {
      gl.deleteFramebuffer(this.target.framebuffer);
      gl.deleteTexture(this.target.texture);
      if (this.target.depthStencil)
        gl.deleteRenderbuffer(this.target.depthStencil);
    }
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer)
      throw new Error("ink: could not create the export target");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    // A colour-only target has no stencil, and the highlighter pass would silently
    // fail to dedupe (§6.2.3). The export path draws highlighters through the same
    // shader, so it needs one too.
    const depthStencil = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depthStencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, width, height);
    gl.framebufferRenderbuffer(
      gl.FRAMEBUFFER,
      gl.DEPTH_STENCIL_ATTACHMENT,
      gl.RENDERBUFFER,
      depthStencil,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.target = { framebuffer, texture, depthStencil, width, height };
    return this.target;
  }

  /** Re-upload everything, after a context restore. */
  private uploadAll(): void {
    for (const batch of this.batches.values()) {
      if (batch.used > 0) this.uploadBatch(batch, 0, batch.used);
    }
    // The texture died with the context; the image did not.
    this.backgroundTexture = null;
    this.uploadBackground();
  }
}

/** Compile and link a program, or throw with the driver's own log. */
function linkProgram(
  gl: WebGL2RenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const build = (type: number, source: string): WebGLShader => {
    const shader = gl.createShader(type);
    if (!shader) throw new Error("ink: could not create a shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`ink: shader failed to compile: ${log ?? "no log"}`);
    }
    return shader;
  };
  const program = gl.createProgram();
  if (!program) throw new Error("ink: could not create a program");
  const vertexShader = build(gl.VERTEX_SHADER, vertex);
  const fragmentShader = build(gl.FRAGMENT_SHADER, fragment);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`ink: program failed to link: ${log ?? "no log"}`);
  }
  return program;
}

/** Whether this runtime can run the WebGL2 renderer at all. */
export function supportsWebglInk(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): boolean {
  try {
    return Boolean(canvas.getContext("webgl2"));
  } catch {
    return false;
  }
}
