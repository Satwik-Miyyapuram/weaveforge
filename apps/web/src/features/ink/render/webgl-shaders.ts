"use client";

/**
 * The ink shaders: the capsule SDF the strokes are drawn with, and the quad
 * the page's background image is drawn through.
 *
 * Split out of `webgl-renderer.ts` when that file crossed the repository's
 * hygiene ceiling. The GLSL is text and the quad is twelve floats; everything
 * that compiles or draws them lives in the renderer.
 */

export const VERTEX_SHADER = `#version 300 es
in vec2 corner;          // unit quad: (0,-1) (1,-1) (1,1) (0,-1) (1,1) (0,1)
in vec4 seg;             // A.xy, B.xy in page units
in vec2 radius;          // rA, rB in page units, per instance
in vec4 neighbours;      // prevA.xy, nextB.xy: the capsules either side
in vec2 neighbourRadius; // prevRA, nextRB; negative when there is no neighbour
uniform vec2 pageSize;   // device pixels, for normalising
uniform vec4 camera;     // scale·dpr, offsetX·dpr, offsetY·dpr (device px), unused
uniform float margin;    // the AA margin in page units
uniform vec2 shift;      // page units: where a dragged selection is shown
uniform float halo;      // page units added to every radius: the selection halo
out vec2 vPage;
// Per-instance constants travel \`flat\`: interpolating a constant across a
// triangle is not guaranteed bit-exact, and the neighbour tie-break below
// compares distances computed from these in two different instances.
flat out vec2 vA;
flat out vec2 vB;
flat out vec2 vRadius;
flat out vec4 vNeighbours;
flat out vec2 vNeighbourRadius;
flat out float vMargin;
void main() {
  vec2 a = seg.xy + shift;
  vec2 b = seg.zw + shift;
  vec2 r = radius + vec2(halo);
  vMargin = margin;
  vec2 d = b - a;
  float len = length(d);
  vec2 dir = len > 0.0001 ? d / len : vec2(1.0, 0.0);
  vec2 normal = vec2(-dir.y, dir.x);
  // Not "half": a reserved word in GLSL ES, which ANGLE on Direct3D rejects.
  float extent = max(r.x, r.y) + margin;
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
  vRadius = r;
  vNeighbours = neighbours + shift.xyxy;
  // A negative neighbour radius means "no neighbour"; the halo must not turn it positive.
  vNeighbourRadius = vec2(
    neighbourRadius.x >= 0.0 ? neighbourRadius.x + halo : neighbourRadius.x,
    neighbourRadius.y >= 0.0 ? neighbourRadius.y + halo : neighbourRadius.y);
  // Page units → clip space. Y is flipped: page y grows downward, clip y upward.
  vec2 scaled = page * camera.x + vec2(camera.y, camera.z);
  vec2 unit = scaled / pageSize;
  gl_Position = vec4(unit.x * 2.0 - 1.0, 1.0 - unit.y * 2.0, 0.0, 1.0);
}`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vPage;
flat in vec2 vA;
flat in vec2 vB;
flat in vec2 vRadius;
flat in vec4 vNeighbours;
flat in vec2 vNeighbourRadius;
flat in float vMargin;
uniform vec4 inkColour;   // rgb + alpha
uniform float feather;    // AA width in page units
// 0: every fragment. 1: only fully covered fragments. 2: only the AA edge.
// The highlighter is drawn in two passes through the stencil (see render()).
uniform int coverage;
out vec4 outColour;
// Signed distance to a capsule whose radius runs from ra at a to rb at b:
// negative inside, zero on the edge.
float capsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  // A degenerate segment — a dot — has no direction to project onto. Guarding the
  // division is what makes the plan's "zero-length segment renders a round dot"
  // true rather than a NaN.
  float denom = max(dot(ba, ba), 0.0001);
  float t = clamp(dot(pa, ba) / denom, 0.0, 1.0);
  return length(pa - ba * t) - mix(ra, rb, t);
}
void main() {
  float sd = capsule(vPage, vA, vB, vRadius.x, vRadius.y);
  // Adjacent capsules overlap, and a pixel in both their edges would be blended
  // twice. So a fragment belongs to whichever capsule it is nearest, and the
  // others discard it. The two instances see the pixel through different
  // quads, so \`vPage\` — and with it every distance — can differ by an ulp
  // between them. An exact tie-break would then let both discard the same
  // pixel, which is a white pinhole in the middle of the ink. So a capsule only
  // yields when the neighbour is nearer by a clear margin; inside that margin
  // both draw, and the double blend is confined to a band far narrower than a
  // pixel.
  const float tie = 0.01;
  if (vNeighbourRadius.x >= 0.0) {
    float before = capsule(vPage, vNeighbours.xy, vA, vNeighbourRadius.x, vRadius.x);
    if (before < sd - tie) discard;
  }
  if (vNeighbourRadius.y >= 0.0) {
    float after = capsule(vPage, vB, vNeighbours.zw, vRadius.y, vNeighbourRadius.y);
    if (after < sd - tie) discard;
  }
  // The edge ramps over one device pixel, centred on the outline: half a pixel
  // either side. A wider ramp reads as a pale border around the ink.
  float fw = max(fwidth(sd), feather) * 0.5;
  float alpha = 1.0 - smoothstep(-fw, fw, sd);
  if (alpha <= 0.0) discard;
  if (coverage == 1 && alpha < 1.0) discard;
  if (coverage == 2 && alpha >= 1.0) discard;
  // Premultiplied: the blend is ONE / ONE_MINUS_SRC_ALPHA.
  float a = inkColour.a * alpha;
  outColour = vec4(inkColour.rgb * a, a);
}`;

export const CORNERS = new Float32Array([0, -1, 1, -1, 1, 1, 0, -1, 1, 1, 0, 1]);

/**
 * The background pass: the page image as one textured quad over the page rect,
 * through the same camera as the strokes. `corner` is the stroke quad's unit
 * geometry reused — x in [0,1], y in [-1,1] — mapped onto the page.
 */
export const BACKGROUND_VERTEX_SHADER = `#version 300 es
in vec2 corner;
uniform vec2 pageSize;   // device pixels
uniform vec4 camera;     // scale·dpr, offsetX·dpr, offsetY·dpr (device px), unused
uniform vec2 pageDims;   // page width and height in page units
out vec2 vUv;
void main() {
  vec2 uv = vec2(corner.x, (corner.y + 1.0) * 0.5);
  vUv = uv;
  vec2 page = uv * pageDims;
  vec2 scaled = page * camera.x + vec2(camera.y, camera.z);
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
