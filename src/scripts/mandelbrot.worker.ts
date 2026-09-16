/**
 * Module worker: computes one Mandelbrot escape-time field per request and
 * transfers the result buffer back. All maths lives in `mandelbrot-kernel`;
 * this file is just the postMessage/transfer plumbing.
 *
 * Loaded by the render engine as:
 *   new Worker(new URL("./mandelbrot.worker.ts", import.meta.url), { type: "module" })
 */

import { computeField } from "./mandelbrot-kernel";
import type { FieldJob, FieldResult } from "./mandelbrot-kernel";

self.onmessage = (event: MessageEvent<FieldJob>) => {
  const { id, cols, rows, cx, cy, cellSpan, maxIter } = event.data;
  const out = new Float32Array(cols * rows);

  const start = performance.now();
  const { lo, hi } = computeField({ cols, rows, cx, cy, cellSpan, maxIter }, out);
  const ms = performance.now() - start;

  const result: FieldResult = { id, cols, rows, data: out, lo, hi, ms };
  (self as unknown as Worker).postMessage(result, [out.buffer]);
};
