"use client";

/**
 * The renderer's offscreen capture target: the framebuffer an export renders
 * into, created on demand and reused between exports at the same size.
 *
 * Split out of `webgl-renderer.ts` when that file crossed the repository's
 * hygiene ceiling. Free functions rather than class members, so the target's
 * lifetime reads as the two things it is: make one, and let it go.
 */

/** An offscreen render target for export, with its own depth-stencil attachment. */
export interface CaptureTarget {
  framebuffer: WebGLFramebuffer;
  texture: WebGLTexture;
  depthStencil: WebGLRenderbuffer | null;
  width: number;
  height: number;
}

/**
 * Reuse the current target when it is already the asked-for size; otherwise
 * throw it away and build another. A colour-only target has no stencil, and
 * the highlighter pass would silently fail to dedupe (§6.2.3) — so it carries
 * a depth-stencil attachment, which the export path needs because highlighters
 * are drawn through the same shader.
 */
export function ensureCaptureTarget(
  gl: WebGL2RenderingContext,
  current: CaptureTarget | null,
  width: number,
  height: number,
): CaptureTarget {
  if (current && current.width === width && current.height === height)
    return current;
  releaseCaptureTarget(gl, current);
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
  return { framebuffer, texture, depthStencil, width, height };
}

/** Let the target go: its buffers die with it, not with the context. */
export function releaseCaptureTarget(
  gl: WebGL2RenderingContext,
  target: CaptureTarget | null,
): void {
  if (!target) return;
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
  if (target.depthStencil) gl.deleteRenderbuffer(target.depthStencil);
}
