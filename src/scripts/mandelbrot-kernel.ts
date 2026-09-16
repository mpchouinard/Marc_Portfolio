/**
 * Pure maths for the Mandelbrot hero: escape-time field computation shared by
 * the render worker (`mandelbrot.worker.ts`) and the offline verifier
 * (`tools/check-mandelbrot-targets.mjs`). No DOM, no canvas, no globals.
 *
 * Written in erasable-TypeScript-only syntax (no enums, no parameter
 * properties, no `namespace`) so `node --experimental-strip-types` can import
 * this file directly with zero build step — that's how the checker runs it.
 *
 * Owned by the maths half of the Mandelbrot hero build. The render engine
 * (Wave-later agent) calls `computeField` through the worker; it does not
 * duplicate this file.
 */

/** One field-computation request: a cols x rows grid centred on (cx, cy). */
export interface FieldRequest {
  cols: number;
  rows: number;
  cx: number;
  cy: number;
  /** Complex-plane width of a single grid cell (cells are square pitch). */
  cellSpan: number;
  maxIter: number;
}

/** Message shape posted TO the worker to request a field. */
export interface FieldJob extends FieldRequest {
  id: number;
}

/** Message shape posted FROM the worker with the finished field. */
export interface FieldResult {
  id: number;
  cols: number;
  rows: number;
  /**
   * cols*rows values: INTERIOR (-1) for interior cells, RAW smooth iteration
   * count nu (NOT brightness) for exterior cells. The caller converts to
   * brightness with `mapBrightness`, using `lo`/`hi` below — typically after
   * smoothing lo/hi across frames (an EMA) so brightness doesn't pump as
   * outlier cells enter or leave the view from frame to frame.
   */
  data: Float32Array;
  /** This frame's own robust brightness range — see FieldStats/computeField. */
  lo: number;
  hi: number;
  ms: number;
}

/** Interior / non-escaped cells are written as this sentinel. */
export const INTERIOR = -1;

/**
 * Fixed shift added to nu before taking its log, so the log domain is always
 * positive. Fixed (not per-frame) so mapBrightness can be called by a
 * caller that only has lo/hi, not the frame's own min/max. Safe for any
 * frame: with BAILOUT_SQ = 256 the smallest possible nu (bailout on the
 * very first iteration) is ~ 1 - log2(0.5*ln(256)) ≈ -0.47, so nu + NU_SHIFT
 * is always comfortably positive.
 */
export const NU_SHIFT = 1;

/** Robust brightness-mapping range for one field, from computeField. */
export interface FieldStats {
  /** log(nu + NU_SHIFT) value at the ~2nd percentile of escaped cells. */
  lo: number;
  /** log(nu + NU_SHIFT) value at the ~98th percentile of escaped cells. */
  hi: number;
}

/** Bailout radius, squared: |z|^2 > this counts as escaped. Large so the
 *  smooth/normalized iteration count (which samples log|z| at escape) is
 *  accurate rather than noisy near the boundary. */
const BAILOUT_SQ = 256;

/**
 * Main cardioid membership test (closed form, avoids iterating points that
 * are provably interior). See the standard derivation: q = (x - 1/4)^2 + y^2,
 * point is interior if q * (q + (x - 1/4)) <= y^2 / 4.
 */
function inMainCardioid(x: number, y: number): boolean {
  const xm = x - 0.25;
  const q = xm * xm + y * y;
  return q * (q + xm) <= 0.25 * y * y;
}

/** Period-2 bulb membership test: the disc centred at (-1, 0) of radius 1/4. */
function inPeriod2Bulb(x: number, y: number): boolean {
  const xp = x + 1;
  return xp * xp + y * y <= 0.0625;
}

/**
 * Escape-time at one point, with smooth (normalized) iteration count for
 * escaped points and Brent-style periodicity detection to short-circuit
 * interior points that the closed-form tests above don't already catch
 * (satellite bulbs, filaments, etc).
 *
 * Returns INTERIOR for points that never escape (or are judged periodic
 * within tolerance), otherwise the smooth iteration count nu >= 0.
 */
function escapeAt(x0: number, y0: number, maxIter: number, tol: number): number {
  if (inMainCardioid(x0, y0) || inPeriod2Bulb(x0, y0)) return INTERIOR;

  let x = 0;
  let y = 0;
  // Brent's cycle-detection: a saved reference point, refreshed at power-of-two
  // steps, compared against the running point every iteration.
  let xs = 0;
  let ys = 0;
  let stepLimit = 2;
  let stepCount = 0;

  for (let n = 0; n < maxIter; n++) {
    const x2 = x * x;
    const y2 = y * y;
    if (x2 + y2 > BAILOUT_SQ) {
      // Smooth iteration count: nu = n + 1 - log2(log|z|).
      const logZ = 0.5 * Math.log(x2 + y2);
      return n + 1 - Math.log2(logZ);
    }

    const xNew = x2 - y2 + x0;
    const yNew = 2 * x * y + y0;
    x = xNew;
    y = yNew;

    stepCount++;
    const dx = x - xs;
    const dy = y - ys;
    if (dx * dx + dy * dy < tol) return INTERIOR;

    if (stepCount === stepLimit) {
      xs = x;
      ys = y;
      stepCount = 0;
      stepLimit *= 2;
    }
  }
  return INTERIOR;
}

/** Number of histogram bins used to estimate the 2nd/98th percentile of
 *  log(nu + NU_SHIFT) over escaped cells, without sorting the field. */
const STATS_BINS = 256;

/**
 * Fills `out` (length >= cols*rows) with the escape-time field for `req`:
 * INTERIOR (-1) for interior cells, the RAW smooth iteration count nu for
 * escaped cells. Brightness is NOT computed here — see `mapBrightness`.
 *
 * Also returns a robust [lo, hi] range (in log(nu + NU_SHIFT) space) for
 * turning that raw field into brightness: the 2nd/98th percentile of
 * log(nu + NU_SHIFT) over escaped cells, estimated with a 256-bin histogram
 * (no sort needed).
 *
 * This used to normalize brightness against the frame's absolute min/max nu.
 * That let a handful of outlier cells (right next to the interior, escaping
 * only after thousands of iterations) set maxNu and crush every other
 * escaped cell into the bottom few brightness buckets — large regions read
 * as one flat dark band, and the outliers could pop in/out of view between
 * frames and pump the whole frame's brightness. Percentile clipping ignores
 * those outliers; the caller (worker/render engine) can also smooth lo/hi
 * across frames (e.g. an EMA) since they're returned instead of baked in.
 */
export function computeField(req: FieldRequest, out: Float32Array): FieldStats {
  const { cols, rows, cx, cy, cellSpan, maxIter } = req;
  // Periodicity tolerance scales with the cell span (deeper zooms need a
  // tighter tolerance to keep resolving thin filaments), clamped away from 0
  // so it never collapses to a no-op comparison in double precision.
  const tol = Math.max(1e-3 * cellSpan, 1e-300) ** 2;

  const halfCols = (cols - 1) / 2;
  const halfRows = (rows - 1) / 2;

  let minLog = Infinity;
  let maxLog = -Infinity;
  let escapedCount = 0;

  for (let row = 0; row < rows; row++) {
    const im = cy - (row - halfRows) * cellSpan;
    for (let col = 0; col < cols; col++) {
      const re = cx + (col - halfCols) * cellSpan;
      const nu = escapeAt(re, im, maxIter, tol);
      out[row * cols + col] = nu;
      if (nu !== INTERIOR) {
        escapedCount++;
        const logVal = Math.log(nu + NU_SHIFT);
        if (logVal < minLog) minLog = logVal;
        if (logVal > maxLog) maxLog = logVal;
      }
    }
  }

  if (escapedCount === 0) return { lo: 0, hi: 0 }; // every cell interior
  if (maxLog - minLog <= 1e-12) return { lo: minLog, hi: maxLog }; // degenerate: ~one nu value

  // Second pass: histogram log(nu + NU_SHIFT) over escaped cells into
  // STATS_BINS bins spanning [minLog, maxLog], then walk the cumulative
  // counts to find the 2nd and 98th percentile bin edges.
  const bins = new Uint32Array(STATS_BINS);
  const binScale = STATS_BINS / (maxLog - minLog);
  const n = cols * rows;
  for (let i = 0; i < n; i++) {
    const nu = out[i];
    if (nu === INTERIOR) continue;
    const logVal = Math.log(nu + NU_SHIFT);
    let bin = Math.floor((logVal - minLog) * binScale);
    if (bin < 0) bin = 0;
    if (bin >= STATS_BINS) bin = STATS_BINS - 1;
    bins[bin]++;
  }

  const loTarget = 0.02 * escapedCount;
  const hiTarget = 0.98 * escapedCount;
  let cumulative = 0;
  let loBin = 0;
  let hiBin = STATS_BINS - 1;
  let foundLo = false;
  for (let b = 0; b < STATS_BINS; b++) {
    cumulative += bins[b];
    if (!foundLo && cumulative >= loTarget) {
      loBin = b;
      foundLo = true;
    }
    if (cumulative >= hiTarget) {
      hiBin = b;
      break;
    }
  }

  const binWidth = (maxLog - minLog) / STATS_BINS;
  const lo = minLog + loBin * binWidth;
  const hi = minLog + (hiBin + 1) * binWidth;
  return { lo, hi: hi > lo ? hi : lo + binWidth };
}

/**
 * Converts a field of RAW nu values (as written by computeField) to
 * brightness in [0, 1] IN PLACE, using the [lo, hi] range (in
 * log(nu + NU_SHIFT) space, e.g. from computeField's returned FieldStats,
 * possibly smoothed across frames by the caller). INTERIOR (-1) cells are
 * left untouched. Values outside [lo, hi] are clamped, not extrapolated,
 * which is what makes this robust to outlier cells (see computeField's
 * comment). A mild gamma (0.9) pulls the low-brightness boundary band up
 * slightly so filament detail doesn't crush to black.
 */
export function mapBrightness(field: Float32Array, lo: number, hi: number, gamma = 0.9): void {
  const range = hi - lo;
  const n = field.length;
  for (let i = 0; i < n; i++) {
    const nu = field[i];
    if (nu === INTERIOR) continue;
    let b: number;
    if (range <= 1e-12) {
      b = 0.5; // degenerate range: flat mid brightness
    } else {
      b = (Math.log(nu + NU_SHIFT) - lo) / range;
      if (b < 0) b = 0;
      if (b > 1) b = 1;
      b = Math.pow(b, gamma);
    }
    field[i] = b;
  }
}

/**
 * Iteration budget for a frame at `scale` within a tour that started at
 * `startScale`. Grows with log2 of the zoom factor so deep frames keep
 * resolving boundary detail instead of the field going uniformly interior
 * (too few iterations to detect escape) or uniformly noisy (wasted cycles).
 * Tuned against tools/check-mandelbrot-targets.mjs targets down to ~1e-12/1e-13.
 */
export function maxIterFor(startScale: number, scale: number): number {
  const zoom = Math.max(1, startScale / scale);
  const iter = 80 + 40 * Math.log2(zoom);
  return Math.min(2500, Math.round(iter));
}
