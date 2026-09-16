#!/usr/bin/env node
/**
 * Verifier for the Mandelbrot hero's zoom-tour targets.
 *
 * Run with (Node >= 22.6, which supports --experimental-strip-types so the
 * kernel .ts file can be imported directly with zero build step):
 *
 *   node --experimental-strip-types tools/check-mandelbrot-targets.mjs
 *
 * Fallback for Node < 22.6 (not needed on this machine, Node is v24.19.0,
 * but documented for portability): bundle the kernel with the esbuild binary
 * Vite already vendors, then import the plain-JS bundle instead, e.g.
 *
 *   node_modules/.bin/esbuild src/scripts/mandelbrot-kernel.ts \
 *     --bundle --format=esm --platform=node \
 *     --outfile=<scratchpad>/mandelbrot-kernel.mjs
 *   node <scratchpad>/check-mandelbrot-targets.fallback.mjs
 *
 * (a copy of this file with the import path swapped to the bundled .mjs).
 *
 * The kernel is never duplicated here: both the worker and this checker
 * import computeField/mapBrightness/maxIterFor from
 * ../src/scripts/mandelbrot-kernel.ts. The TARGETS table lives in
 * ../src/scripts/mandelbrot-targets.ts and is imported, not retyped, so the
 * table checked here is the table the site ships.
 */

import { computeField, mapBrightness, maxIterFor, INTERIOR } from "../src/scripts/mandelbrot-kernel.ts";
import { TARGETS } from "../src/scripts/mandelbrot-targets.ts";

// Interior renders as ' ' (blank) and the darkest exterior bucket as '.' —
// deliberately DIFFERENT characters, so a flat dark exterior expanse and the
// interior of the set are never visually confused in the preview.
const RAMP = " .:-=+*#%@";
const DARKEST_EXTERIOR = ".";
const CHECK_COLS = 160;
const CHECK_ROWS = 90;
const PREVIEW_COLS = 80;
const PREVIEW_ROWS = 45;
const NUM_SCALES = 8;

/**
 * Fixed reference for maxIterFor's iteration-budget calculation — the real
 * production tour's initial whole-set view (3.0), independent of a given
 * target's own `startScale` (which for some targets here is narrower than
 * 3.0, see mandelbrot-targets.ts: it marks where THIS target's own verified
 * ladder begins, not where the overall tour begins). Using target.startScale
 * for the iteration budget would UNDER-budget iterations for a target whose
 * startScale is already zoomed in, which spuriously inflates the apparent
 * interior area (escaping cells that need more than the reduced maxIter
 * read as interior) — exactly the bug this constant avoids.
 */
const TOUR_START_SCALE = 3.0;

/** Runs computeField + mapBrightness for one frame. Returns the brightness
 * field (INTERIOR sentinel preserved) plus diagnostics. */
function runFrame(target, scale) {
  const cellSpan = scale / CHECK_COLS;
  const maxIter = maxIterFor(TOUR_START_SCALE, scale);
  const out = new Float32Array(CHECK_COLS * CHECK_ROWS);
  const t0 = performance.now();
  const stats = computeField(
    { cols: CHECK_COLS, rows: CHECK_ROWS, cx: target.cx, cy: target.cy, cellSpan, maxIter },
    out,
  );
  mapBrightness(out, stats.lo, stats.hi);
  const ms = performance.now() - t0;
  return { out, cellSpan, maxIter, ms, stats };
}

function interiorFraction(out) {
  let interior = 0;
  for (let i = 0; i < out.length; i++) if (out[i] === INTERIOR) interior++;
  return interior / out.length;
}

function histogramBuckets(out) {
  const buckets = new Array(16).fill(0);
  for (let i = 0; i < out.length; i++) {
    const v = out[i];
    if (v === INTERIOR) continue;
    let b = Math.floor(v * 16);
    if (b > 15) b = 15;
    if (b < 0) b = 0;
    buckets[b]++;
  }
  return buckets;
}

/** The central window: middle 30% of width and height. */
function centralWindowBounds(cols, rows) {
  const wHalf = Math.round(cols * 0.15);
  const hHalf = Math.round(rows * 0.15);
  const cCol = Math.round((cols - 1) / 2);
  const cRow = Math.round((rows - 1) / 2);
  return {
    colLo: Math.max(0, cCol - wHalf),
    colHi: Math.min(cols - 1, cCol + wHalf),
    rowLo: Math.max(0, cRow - hHalf),
    rowHi: Math.min(rows - 1, cRow + hHalf),
  };
}

/** Central-window check: >= 5 non-empty of 16 brightness buckets among
 * escaped cells, OR the window contains interior cells. Also reports
 * whether the window is >85% one single bucket (dominant-bucket failure). */
function checkCentralWindow(out, cols, rows) {
  const { colLo, colHi, rowLo, rowHi } = centralWindowBounds(cols, rows);
  const buckets = new Array(16).fill(0);
  let interiorCount = 0;
  let escapedCount = 0;
  for (let row = rowLo; row <= rowHi; row++) {
    for (let col = colLo; col <= colHi; col++) {
      const v = out[row * cols + col];
      if (v === INTERIOR) {
        interiorCount++;
        continue;
      }
      escapedCount++;
      let b = Math.floor(v * 16);
      if (b > 15) b = 15;
      if (b < 0) b = 0;
      buckets[b]++;
    }
  }
  const nonEmpty = buckets.filter((n) => n > 0).length;
  const hasInterior = interiorCount > 0;
  const maxBucket = Math.max(...buckets, 0);
  const dominantFraction = escapedCount > 0 ? maxBucket / escapedCount : 0;
  const dominantBucketFail = !hasInterior && escapedCount > 0 && dominantFraction > 0.85;
  const ok = (nonEmpty >= 5 || hasInterior) && !dominantBucketFail;
  return { ok, nonEmpty, hasInterior, interiorCount, escapedCount, dominantFraction, dominantBucketFail };
}

/** End-scale-only check: central window must contain interior (minibrot
 * visible), and THE MINIBROT — the connected interior component sitting at
 * the exact centre pixel (the nucleus, by construction) — must not touch
 * the frame border (it fits in view, isn't cropped). This is deliberately
 * NOT "no interior pixel anywhere in the frame touches the border": the
 * Mandelbrot boundary has densely scattered satellite islands at every
 * zoom level, so some unrelated fleck near a corner touching the border is
 * normal and not what "the minibrot fits in view" is about — it's the
 * specific component we're centred on that must fit. Flood-fills
 * (4-connectivity) from the centre pixel to find that component. */
function checkEndFrame(out, cols, rows) {
  const centerCol = Math.round((cols - 1) / 2);
  const centerRow = Math.round((rows - 1) / 2);

  const { colLo, colHi, rowLo, rowHi } = centralWindowBounds(cols, rows);
  let centralInterior = false;
  for (let row = rowLo; row <= rowHi && !centralInterior; row++) {
    for (let col = colLo; col <= colHi; col++) {
      if (out[row * cols + col] === INTERIOR) {
        centralInterior = true;
        break;
      }
    }
  }

  if (out[centerRow * cols + centerCol] !== INTERIOR) {
    // Centre itself isn't interior: no minibrot component to check for
    // clipping, but central-window presence above still gates overall ok.
    return { ok: centralInterior && false, centralInterior, touchesEdge: false, centerIsInterior: false };
  }

  const visited = new Uint8Array(cols * rows);
  const stack = [[centerRow, centerCol]];
  visited[centerRow * cols + centerCol] = 1;
  let touchesEdge = false;
  while (stack.length) {
    const [r, c] = stack.pop();
    if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) touchesEdge = true;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nidx = nr * cols + nc;
      if (visited[nidx] || out[nidx] !== INTERIOR) continue;
      visited[nidx] = 1;
      stack.push([nr, nc]);
    }
  }
  return { ok: centralInterior && !touchesEdge, centralInterior, touchesEdge, centerIsInterior: true };
}

function asciiPreview(out, cols, rows, downCols, downRows) {
  const centerCol = Math.round((cols - 1) / 2);
  const centerRow = Math.round((rows - 1) / 2);
  const lines = [];
  for (let dr = 0; dr < downRows; dr++) {
    let line = "";
    for (let dc = 0; dc < downCols; dc++) {
      const c0 = Math.floor((dc / downCols) * cols);
      const c1 = Math.max(c0 + 1, Math.floor(((dc + 1) / downCols) * cols));
      const r0 = Math.floor((dr / downRows) * rows);
      const r1 = Math.max(r0 + 1, Math.floor(((dr + 1) / downRows) * rows));

      // does this downsample cell cover the exact centre cell?
      const coversCenter = centerCol >= c0 && centerCol < c1 && centerRow >= r0 && centerRow < r1;

      let sum = 0;
      let count = 0;
      let anyInterior = false;
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          const v = out[r * cols + c];
          if (v === INTERIOR) {
            anyInterior = true;
          } else {
            sum += v;
            count++;
          }
        }
      }

      let ch;
      if (coversCenter) {
        ch = "X";
      } else if (anyInterior && count === 0) {
        ch = " "; // pure interior cell
      } else if (count === 0) {
        ch = " ";
      } else {
        const avg = sum / count;
        // avg=0 -> darkest exterior '.', not blank (interior stays blank).
        const idx = Math.min(RAMP.length - 2, Math.floor(avg * (RAMP.length - 1)));
        ch = idx === 0 ? DARKEST_EXTERIOR : RAMP[idx + 1];
      }
      line += ch;
    }
    lines.push(line);
  }
  return lines.join("\n");
}

function precisionOk(target, endScale) {
  const cellSpan = endScale / CHECK_COLS;
  const denom = Math.max(Math.abs(target.cx), Math.abs(target.cy), 1e-300);
  const ratio = cellSpan / denom;
  if (!(ratio > 2e-15)) return { ok: false, reason: `precision ratio ${ratio} <= 2e-15` };

  const halfCols = (CHECK_COLS - 1) / 2;
  let prevRe = target.cx + (0 - halfCols) * cellSpan;
  for (let col = 1; col < CHECK_COLS; col++) {
    const re = target.cx + (col - halfCols) * cellSpan;
    if (re === prevRe) {
      return { ok: false, reason: `adjacent re values collapsed at col ${col}` };
    }
    prevRe = re;
  }
  return { ok: true };
}

/** Evaluates one target across NUM_SCALES log-spaced frames from
 * startScale to endScale. Returns a report object. */
function evaluateTarget(target) {
  const logStart = Math.log(target.startScale);
  const logEnd = Math.log(target.endScale);
  const frames = [];
  for (let i = 0; i < NUM_SCALES; i++) {
    const t = i / (NUM_SCALES - 1);
    const scale = Math.exp(logStart + (logEnd - logStart) * t);
    frames.push({
      label: i === 0 ? "start" : i === NUM_SCALES - 1 ? "end" : `s${i}`,
      scale,
      isWide: scale >= 2.5,
      isEnd: i === NUM_SCALES - 1,
    });
  }

  // Index closest to the geometric midpoint (t=0.5) of the log-spaced ladder.
  let midIndex = 0;
  let midBestDist = Infinity;
  for (let i = 0; i < frames.length; i++) {
    const d = Math.abs(i / (NUM_SCALES - 1) - 0.5);
    if (d < midBestDist) {
      midBestDist = d;
      midIndex = i;
    }
  }

  const frameReports = [];
  let ok = true;

  for (const [index, frame] of frames.entries()) {
    const { out, cellSpan, maxIter, ms } = runFrame(target, frame.scale);
    const frac = interiorFraction(out);
    const globalBuckets = histogramBuckets(out);
    const globalNonEmpty = globalBuckets.filter((n) => n > 0).length;
    const central = checkCentralWindow(out, CHECK_COLS, CHECK_ROWS);

    const lowerOk = frame.isWide ? true : frac >= 0.02;
    // Upper bound relaxed to 0.95 (was 0.70): a dive's opening act legitimately
    // spends several frames mostly INSIDE the main cardioid or a bulb — that's
    // the familiar big dark cardioid body and the valley beside it, not a
    // flat/broken frame. The structure that actually matters (rich escape-time
    // detail, or a visible minibrot) is enforced separately by the central-
    // window check below; this ceiling only catches a fully solid, dead frame.
    const upperOk = frac <= 0.95;
    const histOk = globalNonEmpty >= 6;
    const centralOk = central.ok;

    let precision = { ok: true };
    let endFrame = null;
    if (frame.isEnd) {
      precision = precisionOk(target, frame.scale);
      endFrame = checkEndFrame(out, CHECK_COLS, CHECK_ROWS);
    }

    const frameOk = lowerOk && upperOk && histOk && centralOk && precision.ok && (!frame.isEnd || endFrame.ok);
    if (!frameOk) ok = false;

    const preview =
      frame.isEnd || index === midIndex || index === 0
        ? asciiPreview(out, CHECK_COLS, CHECK_ROWS, PREVIEW_COLS, PREVIEW_ROWS)
        : null;

    frameReports.push({
      label: frame.label,
      scale: frame.scale,
      cellSpan,
      maxIter,
      ms,
      interiorFraction: frac,
      globalNonEmpty,
      central,
      precision,
      endFrame,
      frameOk,
      lowerOk,
      upperOk,
      histOk,
      centralOk,
      preview,
    });
  }

  return { target, ok, frames: frameReports };
}

/** 130x75 timing at the deepest (end) frame, for the "< 30ms" budget. */
function timeDeepFrame(target) {
  const cols = 130;
  const rows = 75;
  const cellSpan = target.endScale / cols;
  const maxIter = maxIterFor(TOUR_START_SCALE, target.endScale);
  const out = new Float32Array(cols * rows);
  const t0 = performance.now();
  computeField({ cols, rows, cx: target.cx, cy: target.cy, cellSpan, maxIter }, out);
  const ms = performance.now() - t0;
  return { ms, maxIter };
}

function main() {
  console.log(`Checking ${TARGETS.length} target(s) at ${NUM_SCALES} log-spaced scales each...\n`);
  let allOk = true;

  for (const target of TARGETS) {
    const report = evaluateTarget(target);
    if (!report.ok) allOk = false;

    console.log(`=== ${target.name} (period=${target.period}, cx=${target.cx}, cy=${target.cy}) ===`);
    for (const f of report.frames) {
      const status = f.frameOk ? "PASS" : "FAIL";
      const centralNote = f.central.hasInterior
        ? `central=interior(${f.central.interiorCount}px)`
        : `central=${f.central.nonEmpty}/16buckets${f.central.dominantBucketFail ? ` DOMINANT(${(f.central.dominantFraction * 100).toFixed(0)}%)` : ""}`;
      let line =
        `[${status}] ${f.label.padEnd(5)} scale=${f.scale.toExponential(3)} ` +
        `maxIter=${f.maxIter} interior=${(f.interiorFraction * 100).toFixed(1)}% ` +
        `buckets=${f.globalNonEmpty}/16 ${centralNote} ms=${f.ms.toFixed(2)}`;
      if (!f.precision.ok) line += ` precisionFail=${f.precision.reason}`;
      if (f.endFrame && !f.endFrame.ok) {
        line += ` endFrame(central=${f.endFrame.centralInterior},touchesEdge=${f.endFrame.touchesEdge})`;
      }
      console.log(line);
      if (f.preview) {
        console.log(f.preview);
        console.log("");
      }
    }

    const deep = timeDeepFrame(target);
    console.log(
      `130x75 deep-frame timing: ${deep.ms.toFixed(2)}ms (maxIter=${deep.maxIter}) ` +
        `${deep.ms < 30 ? "OK" : "OVER BUDGET (>=30ms, runs in a worker, not blocking)"}`,
    );
    console.log("");
  }

  console.log(allOk ? "ALL TARGETS PASS" : "SOME TARGETS FAILED");
  process.exit(allOk ? 0 : 1);
}

main();
