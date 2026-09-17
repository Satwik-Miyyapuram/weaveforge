"use client";

/**
 * The WebGL2 renderer's plumbing: program linking and the capability probe.
 *
 * Split out of `webgl-renderer.ts` when that file crossed the repository's
 * hygiene ceiling. Nothing here knows about strokes.
 */

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

