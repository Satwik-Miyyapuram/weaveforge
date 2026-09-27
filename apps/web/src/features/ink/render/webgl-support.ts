"use client";

/**
 * The WebGL2 renderer's plumbing: program linking, the capability probe and
 * the page scissor.
 *
 * Split out of `webgl-renderer.ts` when that file crossed the repository's
 * hygiene ceiling. Nothing here knows about strokes.
 */

import type { InkViewTransform } from "./ink-renderer";

/** Compile and link a program, or throw with the driver's own log. */
export function linkProgram(
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

/**
 * Whether this runtime can run the WebGL2 renderer at all.
 *
 * Probed on a scratch canvas, never on the one the renderer will draw to: a
 * canvas keeps the first context it hands out, attributes and all, so a probe
 * with the defaults on the real canvas would leave the renderer a context
 * with no stencil — and the highlighter's dedupe would silently become a
 * plain translucent overdraw, seams at every capsule and darker crossings.
 */
export function supportsWebglInk(
  canvas: OffscreenCanvas | HTMLCanvasElement,
): boolean {
  try {
    const scratch =
      typeof OffscreenCanvas === "function"
        ? new OffscreenCanvas(1, 1)
        : canvas instanceof HTMLCanvasElement
          ? canvas.ownerDocument.createElement("canvas")
          : canvas;
    return Boolean(scratch.getContext("webgl2"));
  } catch {
    return false;
  }
}


/**
 * The page's box on a drawing surface of `width` × `height` device pixels, as
 * `gl.scissor`'s arguments: GL counts rows from the foot.
 */
export function pageScissor(
  transform: InkViewTransform,
  dpr: number,
  pageWidth: number,
  pageHeight: number,
  width: number,
  height: number,
): [number, number, number, number] {
  const k = transform.scale * dpr;
  const left = Math.max(0, Math.floor(transform.offsetX * dpr));
  const top = Math.max(0, Math.floor(transform.offsetY * dpr));
  const right = Math.min(width, Math.ceil(transform.offsetX * dpr + pageWidth * k));
  const bottom = Math.min(height, Math.ceil(transform.offsetY * dpr + pageHeight * k));
  return [left, height - Math.max(top, bottom), Math.max(0, right - left), Math.max(0, bottom - top)];
}
