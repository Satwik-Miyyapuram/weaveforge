/**
 * The shaders, read as text.
 *
 * Node has no GPU, so whether the shaders compile is only known on a machine with
 * one — and the answer differs by driver. ANGLE on Direct3D, which is what the
 * desktop app gets on a Surface, enforces the GLSL ES reserved-word list where
 * a desktop GL driver lets an identifier like `half` through. A reserved word
 * used as a name took the WebGL2 renderer down on the target hardware, and with
 * it the Canvas 2D fallback, since the canvas had already given out a WebGL
 * context. This test is the part of that failure that can be caught here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BACKGROUND_FRAGMENT_SHADER,
  BACKGROUND_VERTEX_SHADER,
  FRAGMENT_SHADER,
  VERTEX_SHADER,
} from "../render/webgl-renderer";

/** GLSL ES 3.00 §3.7: keywords reserved for future use, plus the vendor ones. */
const RESERVED = [
  "attribute",
  "varying",
  "coherent",
  "restrict",
  "readonly",
  "writeonly",
  "resource",
  "atomic_uint",
  "noperspective",
  "patch",
  "sample",
  "subroutine",
  "common",
  "partition",
  "active",
  "asm",
  "class",
  "union",
  "enum",
  "typedef",
  "template",
  "this",
  "goto",
  "inline",
  "noinline",
  "volatile",
  "public",
  "static",
  "extern",
  "external",
  "interface",
  "long",
  "short",
  "double",
  "half",
  "fixed",
  "unsigned",
  "superp",
  "input",
  "output",
  "hvec2",
  "hvec3",
  "hvec4",
  "dvec2",
  "dvec3",
  "dvec4",
  "fvec2",
  "fvec3",
  "fvec4",
  "sampler3DRect",
  "filter",
  "image1D",
  "image2D",
  "image3D",
  "imageCube",
  "iimage1D",
  "iimage2D",
  "iimage3D",
  "iimageCube",
  "uimage1D",
  "uimage2D",
  "uimage3D",
  "uimageCube",
  "image1DArray",
  "image2DArray",
  "iimage1DArray",
  "iimage2DArray",
  "uimage1DArray",
  "uimage2DArray",
  "imageBuffer",
  "iimageBuffer",
  "uimageBuffer",
  "sizeof",
  "cast",
  "namespace",
  "using",
];

const SHADERS = {
  VERTEX_SHADER,
  FRAGMENT_SHADER,
  BACKGROUND_VERTEX_SHADER,
  BACKGROUND_FRAGMENT_SHADER,
};

/** The source with comments removed, so a word in a comment is not a hit. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

test("no shader uses a GLSL ES reserved word as an identifier", () => {
  for (const [name, source] of Object.entries(SHADERS)) {
    const code = stripComments(source);
    const identifiers = new Set(code.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []);
    const hits = RESERVED.filter((word) => identifiers.has(word));
    assert.deepEqual(hits, [], `${name} uses reserved: ${hits.join(", ")}`);
  }
});

test("every shader declares GLSL ES 3.00 on its first line", () => {
  for (const [name, source] of Object.entries(SHADERS))
    assert.ok(source.startsWith("#version 300 es\n"), name);
});
