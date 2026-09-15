"use client";

/**
 * The renderer's stroke batches: one buffer set per colour and pass, so a
 * draw is one instanced call.
 *
 * Split out of `webgl-renderer.ts` when that file crossed the repository's
 * hygiene ceiling. The pool owns the map and the CPU-side instance arrays;
 * the draws and the uploads take the program and the uniforms they need,
 * because those belong to the program that is bound, not to the pool.
 */

import type { InkColour } from "@weaveforge/core";

import {
  INK_INSTANCE_FLOATS,
} from "./ink-renderer";
import type { InkPalette, InkRgb } from "./ink-palette";

/** One colour's geometry, resident in its own buffers so a draw is one call. */
export interface Batch {
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

/** What drawing a batch needs of the program it belongs to. */
export interface InkBatchTarget {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  colourUniform: WebGLUniformLocation | null;
  palette: () => InkPalette;
}

export class InkBatches {
  private readonly map = new Map<string, Batch>();

  constructor(private readonly target: InkBatchTarget) {}

  /** The batch a colour and pass belong to. */
  batchFor(colour: InkColour, highlighter: boolean, live = false): Batch {
    const key = `${live ? "live:" : ""}${highlighter ? "hl" : "pen"}:${colour}`;
    const existing = this.map.get(key);
    if (existing) return existing;
    const batch: Batch = {
      colour,
      highlighter,
      data: new Float32Array(INK_INSTANCE_FLOATS * 512),
      records: [],
      buffer: this.target.gl.createBuffer(),
      capacity: 512,
      used: 0,
    };
    this.map.set(key, batch);
    return batch;
  }

  /** Empty the committed batches; the live one is a stroke in flight. */
  clear(): void {
    for (const [key, batch] of [...this.map.entries()]) {
      if (key.startsWith("live:")) continue;
      batch.records = [];
      batch.used = 0;
    }
  }

  /** Every batch, including the live one, for a context restore. */
  all(): IterableIterator<Batch> {
    return this.map.values();
  }

  /** How many batches are resident, for the render stats. */
  get size(): number {
    return this.map.size;
  }

  /** Let every buffer go, on the way out of the renderer. */
  dispose(): void {
    const gl = this.target.gl;
    for (const batch of this.map.values()) {
      if (batch.buffer) gl.deleteBuffer(batch.buffer);
    }
    this.map.clear();
  }

  /** Grow a batch's CPU-side array to hold `segments`, doubling as it goes. */
  ensureCapacity(batch: Batch, segments: number): void {
    if (segments <= batch.capacity) return;
    let capacity = batch.capacity;
    while (capacity < segments) capacity *= 2;
    const grown = new Float32Array(capacity * INK_INSTANCE_FLOATS);
    grown.set(batch.data);
    batch.data = grown;
    batch.capacity = capacity;
  }

  /** Push one range of a batch to the GPU. */
  upload(batch: Batch, offset: number, count: number): void {
    const gl = this.target.gl;
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
  draw(
    batch: Batch,
    alphaOverride?: number,
    first = 0,
    count = batch.used - first,
    colourOverride?: InkRgb,
  ): number {
    const gl = this.target.gl;
    const program = this.target.program;
    if (!batch.buffer || count <= 0) return 0;
    const base = first * INK_INSTANCE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    const segmentLocation = gl.getAttribLocation(program, "seg");
    gl.enableVertexAttribArray(segmentLocation);
    gl.vertexAttribPointer(
      segmentLocation,
      4,
      gl.FLOAT,
      false,
      INK_INSTANCE_FLOATS * 4,
      base + 0,
    );
    gl.vertexAttribDivisor(segmentLocation, 1);
    const radiusLocation = gl.getAttribLocation(program, "radius");
    gl.enableVertexAttribArray(radiusLocation);
    gl.vertexAttribPointer(
      radiusLocation,
      2,
      gl.FLOAT,
      false,
      INK_INSTANCE_FLOATS * 4,
      base + 16,
    );
    gl.vertexAttribDivisor(radiusLocation, 1);
    const neighbourLocation = gl.getAttribLocation(program, "neighbours");
    gl.enableVertexAttribArray(neighbourLocation);
    gl.vertexAttribPointer(
      neighbourLocation,
      4,
      gl.FLOAT,
      false,
      INK_INSTANCE_FLOATS * 4,
      base + 24,
    );
    gl.vertexAttribDivisor(neighbourLocation, 1);
    const neighbourRadiusLocation = gl.getAttribLocation(
      program,
      "neighbourRadius",
    );
    gl.enableVertexAttribArray(neighbourRadiusLocation);
    gl.vertexAttribPointer(
      neighbourRadiusLocation,
      2,
      gl.FLOAT,
      false,
      INK_INSTANCE_FLOATS * 4,
      base + 40,
    );
    gl.vertexAttribDivisor(neighbourRadiusLocation, 1);

    const palette = this.target.palette();
    const rgb =
      colourOverride ?? palette[batch.colour] ?? palette.text;
    const alpha = alphaOverride ?? (batch.highlighter ? 0.35 : 1);
    gl.uniform4f(this.target.colourUniform, rgb[0], rgb[1], rgb[2], alpha);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count);
    return count;
  }
}

