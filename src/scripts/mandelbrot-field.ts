/**
 * The Mandelbrot hero field: the homepage's signature moment. Where
 * `glyph-field.ts` samples a summed-sinusoid scalar field (the "ambient"
 * background family described in CLAUDE.md §5), this engine samples
 * escape-time membership of the Mandelbrot set itself: a different maths
 * family entirely. It reads as one visual system with the ambient field
 * anyway because it draws through the exact same pieces: `glyph-kit`'s
 * alphabet, colour ramp and additive bloom atlas. Nothing here re-derives a
 * palette or a glow sprite; both are borrowed so a viewer can't tell the two
 * canvases apart by their materials, only by what they're plotting.
 *
 * The field is a continuous tour of `TARGETS` (`./mandelbrot-targets.ts`):
 * each entry dives from a wide view to a scale where its nucleus's own
 * embedded copy of the whole set fills the frame, holds there, then
 * dissolves glyph-by-glyph into the next target. `DIVE_SECONDS` is fixed
 * per target rather than scaled to each target's zoom ratio, because what
 * matters for pacing is dwell time on screen, not distance travelled: a
 * shallow dive and a deep one both need roughly the same number of seconds
 * for a viewer to read the boundary detail sweeping past. Targets differ in
 * how deep their minibrot reveals (roughly 450x to 6700x per
 * `mandelbrot-targets.ts`), which is exactly why a fixed per-target duration
 * was chosen over a fixed zoom-rate: a rate-based tour would make the
 * shallow targets feel rushed and the deep ones feel endless.
 *
 * Escape-time computation is expensive per cell and gets slower with depth
 * (the iteration budget grows with zoom, see `maxIterFor`), so it runs in a
 * dedicated module worker (`mandelbrot.worker.ts`) rather than on the main
 * thread: a deep frame that takes tens of milliseconds must never stall
 * drawing or input. The render loop always draws the most recently completed
 * buffer and posts at most one job at a time, so a slow frame just means the
 * next draw reuses the previous buffer a little longer, never a dropped
 * frame elsewhere on the page.
 *
 * The dissolve between targets is a per-cell threshold crossfade, not an
 * alpha blend: because the surface is a character grid, a glyph-by-glyph
 * reveal (each cell independently flips from the outgoing target's frozen
 * frame to the incoming target's live one, once its own random threshold is
 * cleared) reads as the same "thinking" texture the rest of the tour has,
 * where a plain alpha crossfade would read as a video dissolve and break
 * the illusion that this is a live computation.
 *
 * To add or adjust a target, see `tools/check-mandelbrot-targets.mjs`: it
 * verifies a candidate nucleus/scale table renders sensibly (interior
 * fraction, brightness spread, the minibrot fitting in frame at endScale,
 * double-precision headroom) before it ships.
 */

import { prefersReducedMotion, onReducedMotionChange } from "./motion";
import {
  GLYPHS,
  FONT_FALLBACK,
  FONT_RATIO,
  readCssVar,
  buildPalette,
  buildGlowAtlas,
  drawCrests,
  type Palette,
  type GlowAtlas,
} from "./glyph-kit";
import { computeField, mapBrightness, maxIterFor, INTERIOR } from "./mandelbrot-kernel";
import type { FieldJob, FieldResult } from "./mandelbrot-kernel";
import { TARGETS } from "./mandelbrot-targets";
import type { Target } from "./mandelbrot-targets";

/* Grid density: this canvas is read up close as the hero's one signature
   element, where the ambient field is a peripheral backdrop the reader
   mostly isn't looking straight at. Escape-time detail (thin filaments,
   spiral arms) needs finer sampling to read at all, so this grid targets
   more than double the ambient field's cell count. The ambient field's
   2026-08-29 "wider glyphs, denser field" tuning was an owner decision
   about THAT field's peripheral read; it doesn't transfer here, where
   resolving character-scale boundary detail wins over glyph size. */
const TARGET_CELLS = 4200;
/* Fallback grid density when there's no Worker to offload to (see
   `workerHandle` below): main-thread computation is gated to every other
   frame in that path, so the grid is also thinned to keep a frame's cost
   bounded even without the worker's slack. */
const FALLBACK_TARGET_CELLS = 2000;
const MIN_CELL_PX = 14;
const MAX_DPR = 2;
const RESIZE_DEBOUNCE_MS = 150;

/* PERFORMANCE: the main glyph pass used to call fillText per cell, batched
   by fillStyle via a counting sort. Measured in-browser at 1440x900
   (dpr 1.25, ~4400 cells): 13.7ms/frame even with that batching, against a
   16.7ms frame budget, and stats() was reporting 15-22ms total. The same
   grid blitted with drawImage from a pre-rendered colour x glyph atlas cost
   6.7ms at 1440x900 and 7.1ms at 1920x1080 (atlas build itself 0.8-2.6ms,
   paid once per resize, not per frame). Quantizing brightness to
   COLOR_LEVELS buckets trades a little colour smoothness (imperceptible at
   this glyph size) for one blit per cell instead of a font shaping pass. */
const COLOR_LEVELS = 32;

/* Tour pacing. Each target gets the same on-screen dwell time regardless of
   its zoom ratio (see the top-of-file comment); the hold is a beat to let
   the revealed minibrot register as a recognizable whole-set silhouette
   before the dissolve starts breaking it apart. */
const DIVE_SECONDS = 45;
const HOLD_SECONDS = 2.5;
const DISSOLVE_SECONDS = 2.5;

/* Brightness smoothing: EMA factor applied to each frame's [lo, hi] robust
   range (see mandelbrot-kernel's FieldStats) so per-frame outlier cells
   don't pump the whole field's brightness up or down as the view moves. */
const EMA_FACTOR = 0.15;

/* Glyph identity churn, same mechanic as the ambient field ("thinking," not
   raining). Multiplied during a dissolve so the crossfade itself reads as
   active computation rather than a static wipe. */
const BASE_REROLL_RATE = 0.006;
const DISSOLVE_REROLL_MULT = 6;

/** Ease a linear [0, 1] dive-progress fraction into a gentle in/out curve
 *  on the LOG-scale exponent (see computeDiveScale): slow to leave the wide
 *  view, a steady middle traversal, slow again as the minibrot arrives so it
 *  doesn't snap into frame. */
function easeInOutLog(t: number): number {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return (1 - Math.cos(Math.PI * c)) / 2;
}

/** Current view scale (complex-plane width) for a target at `diveElapsed`
 *  seconds into its dive. Clamps past DIVE_SECONDS so calling this during
 *  the hold phase (diveElapsed >= DIVE_SECONDS) naturally returns endScale
 *  with no separate branch needed. */
function computeDiveScale(target: Target, diveElapsed: number): number {
  const t = Math.min(diveElapsed, DIVE_SECONDS) / DIVE_SECONDS;
  const eased = easeInOutLog(t);
  return target.startScale * Math.pow(target.endScale / target.startScale, eased);
}

function clampBucket(brightness: number, lastBucket: number): number {
  const b = Math.floor(brightness * lastBucket);
  return b < 0 ? 0 : b > lastBucket ? lastBucket : b;
}

/** Colour x glyph sprite sheet for the main draw pass, keyed like
 *  glyph-kit's GlowAtlas so a resize (or a palette rebuild) invalidates it
 *  and nothing else does. Rows are quantized brightness levels
 *  (COLOR_LEVELS of them, sampled from the 128-stop palette), columns are
 *  glyphs: `rowY = level * tile`, `colX = glyph * tile`. See the
 *  PERFORMANCE comment above COLOR_LEVELS for why this replaced per-cell
 *  fillText. */
interface ColorAtlas {
  atlas: HTMLCanvasElement;
  tile: number;
  key: string;
}

function buildColorAtlas(
  cellSize: number,
  dpr: number,
  fontFamily: string,
  palette: Palette,
  previous: ColorAtlas | null,
): ColorAtlas | null {
  const tile = Math.ceil(cellSize);
  const fontSize = cellSize * FONT_RATIO;
  const lastStop = palette.stops.length - 1;
  // Palette colours aren't a stable identity to key on directly, so sample
  // the ends of the ramp the way glyph-kit samples accent/bloom for its own
  // atlas key: a token change invalidates the sheet instead of leaving
  // stale colours baked in.
  const key = `${tile}|${dpr}|${fontFamily}|${palette.stops[0]}|${palette.stops[lastStop]}`;
  if (previous && previous.key === key) return previous;

  const srcTile = Math.max(1, Math.round(tile * dpr));
  const sheet = document.createElement("canvas");
  sheet.width = srcTile * GLYPHS.length;
  sheet.height = srcTile * COLOR_LEVELS;
  const sheetCtx = sheet.getContext("2d");
  if (!sheetCtx) return null;

  sheetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sheetCtx.font = `${fontSize}px ${fontFamily}`;
  sheetCtx.textAlign = "center";
  sheetCtx.textBaseline = "middle";

  for (let level = 0; level < COLOR_LEVELS; level++) {
    const stopIndex = Math.round((level * lastStop) / (COLOR_LEVELS - 1));
    sheetCtx.fillStyle = palette.stops[stopIndex];
    const rowY = level * tile + tile / 2;
    for (let g = 0; g < GLYPHS.length; g++) {
      sheetCtx.fillText(GLYPHS[g], g * tile + tile / 2, rowY);
    }
  }

  return { atlas: sheet, tile, key };
}

interface Grid {
  cols: number;
  rows: number;
  cellSize: number;
  cssWidth: number;
  cssHeight: number;
  glyphIndices: Uint8Array;
  /** One random threshold per cell, fixed until the next resize: during a
   *  dissolve, a cell switches from the outgoing to the incoming target's
   *  frame once dissolve progress clears its own threshold. */
  dissolveThresholds: Float32Array;
}

function computeGrid(cssWidth: number, cssHeight: number, targetCells: number): Grid {
  const area = Math.max(1, cssWidth * cssHeight);
  const rawCell = Math.sqrt(area / targetCells);
  const cellSize = Math.max(rawCell, MIN_CELL_PX);
  const cols = Math.max(1, Math.ceil(cssWidth / cellSize) + 1);
  const rows = Math.max(1, Math.ceil(cssHeight / cellSize) + 1);
  const count = cols * rows;

  const glyphIndices = new Uint8Array(count);
  const dissolveThresholds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    glyphIndices[i] = Math.floor(Math.random() * GLYPHS.length);
    dissolveThresholds[i] = Math.random();
  }

  return { cols, rows, cellSize, cssWidth, cssHeight, glyphIndices, dissolveThresholds };
}

interface BufferMeta {
  targetIndex: number;
  scale: number;
  cols: number;
  rows: number;
}

export interface MandelbrotFieldStats {
  frames: number;
  lastDrawMs: number;
  lastJobMs: number;
  target: string;
  scale: number;
}

export interface MandelbrotFieldHandle {
  destroy(): void;
  /** Gate the loop on top of intersection/visibility/reduced-motion, e.g.
   *  Hero.astro can suspend the tour while another layer covers it. */
  setActive(active: boolean): void;
  stats(): MandelbrotFieldStats;
}

const instances = new WeakMap<HTMLCanvasElement, MandelbrotFieldHandle>();

export function getMandelbrotField(canvas: HTMLCanvasElement): MandelbrotFieldHandle | undefined {
  return instances.get(canvas);
}

export function initMandelbrotField(canvas: HTMLCanvasElement): MandelbrotFieldHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    const noop: MandelbrotFieldHandle = {
      destroy() {},
      setActive() {},
      stats() {
        return { frames: 0, lastDrawMs: 0, lastJobMs: 0, target: TARGETS[0].name, scale: TARGETS[0].startScale };
      },
    };
    instances.set(canvas, noop);
    return noop;
  }

  let reduced = prefersReducedMotion();
  let palette: Palette = buildPalette();

  // Worker construction: escape-time is too slow at depth for the main
  // thread. If Workers aren't available (or construction throws) fall back
  // to synchronous computation gated to every other frame at a lower cell
  // target, rather than not rendering at all.
  let workerHandle: Worker | null = null;
  try {
    if (typeof Worker === "undefined") throw new Error("Worker unsupported");
    workerHandle = new Worker(new URL("./mandelbrot.worker.ts", import.meta.url), { type: "module" });
  } catch {
    workerHandle = null;
  }
  const targetCellsForGrid = workerHandle ? TARGET_CELLS : FALLBACK_TARGET_CELLS;

  let dpr = 1;
  let grid = computeGrid(
    canvas.clientWidth || window.innerWidth,
    canvas.clientHeight || window.innerHeight,
    targetCellsForGrid,
  );

  let fontFamily = FONT_FALLBACK;
  let glow: GlowAtlas | null = null;
  let colorAtlas: ColorAtlas | null = null;

  let running = false;
  let active = true;
  let isIntersecting = true;
  let destroyed = false;
  let rafId: number | null = null;
  let resizeTimer: number | undefined;
  let lastFrameTime: number | null = null;

  // Tour state.
  let targetIndex = 0;
  let diveElapsed = 0;
  let dissolveActive = false;
  let dissolveElapsed = 0;

  let currentBuffer: Float32Array | null = null;
  let currentMeta: BufferMeta | null = null;
  let outgoingBuffer: Float32Array | null = null;

  let emaLo = 0;
  let emaHi = 0;
  let emaTargetIndex = -1;

  let workerIdle = true;
  let pendingMeta: BufferMeta | null = null;
  let jobCounter = 0;
  let fallbackFrameCounter = 0;

  let frames = 0;
  let lastDrawMs = 0;
  let lastJobMs = 0;

  // Reused across frames so the crest bloom pass never allocates per draw.
  const crestX: number[] = [];
  const crestY: number[] = [];
  const crestGlyph: number[] = [];

  function resizeCanvasToDisplaySize(): void {
    dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const cssWidth = canvas.clientWidth || window.innerWidth;
    const cssHeight = canvas.clientHeight || window.innerHeight;
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

    palette = buildPalette();
    grid = computeGrid(cssWidth, cssHeight, targetCellsForGrid);
    fontFamily = readCssVar("--font-mono", FONT_FALLBACK);
    glow = buildGlowAtlas(grid.cellSize, dpr, fontFamily, glow);
    colorAtlas = buildColorAtlas(grid.cellSize, dpr, fontFamily, palette, colorAtlas);

    // Buffers from the old grid no longer match cell-for-cell; drop them
    // rather than draw a mismatched frame. A dissolve in progress is also
    // abandoned: its two buffers are exactly the stale state this guards
    // against, and the tour just continues diving on the new grid.
    currentBuffer = null;
    currentMeta = null;
    outgoingBuffer = null;
    dissolveActive = false;
    pendingMeta = null;
  }

  function handleResult(result: FieldResult, meta: BufferMeta): void {
    if (emaTargetIndex !== meta.targetIndex) {
      emaLo = result.lo;
      emaHi = result.hi;
      emaTargetIndex = meta.targetIndex;
    } else {
      emaLo += (result.lo - emaLo) * EMA_FACTOR;
      emaHi += (result.hi - emaHi) * EMA_FACTOR;
    }
    mapBrightness(result.data, emaLo, emaHi);
    currentBuffer = result.data;
    currentMeta = { targetIndex: meta.targetIndex, scale: meta.scale, cols: result.cols, rows: result.rows };
    lastJobMs = result.ms;
  }

  if (workerHandle) {
    workerHandle.onmessage = (event: MessageEvent<FieldResult>) => {
      workerIdle = true;
      const meta = pendingMeta;
      pendingMeta = null;
      if (!meta) return;
      const result = event.data;
      // Stale: a resize landed while this job was in flight.
      if (result.cols !== grid.cols || result.rows !== grid.rows) return;
      handleResult(result, meta);
    };
  }

  function postJobToWorker(target: Target): void {
    const scale = computeDiveScale(target, diveElapsed);
    const cellSpan = scale / grid.cols;
    const maxIter = maxIterFor(target.startScale, scale);
    pendingMeta = { targetIndex, scale, cols: grid.cols, rows: grid.rows };
    workerIdle = false;
    const job: FieldJob = {
      id: ++jobCounter,
      cols: grid.cols,
      rows: grid.rows,
      cx: target.cx,
      cy: target.cy,
      cellSpan,
      maxIter,
    };
    workerHandle!.postMessage(job);
  }

  function postJobFallback(target: Target): void {
    fallbackFrameCounter++;
    if (fallbackFrameCounter % 2 !== 0) return;
    const scale = computeDiveScale(target, diveElapsed);
    const cellSpan = scale / grid.cols;
    const maxIter = maxIterFor(target.startScale, scale);
    const out = new Float32Array(grid.cols * grid.rows);
    const t0 = performance.now();
    const stats = computeField(
      { cols: grid.cols, rows: grid.rows, cx: target.cx, cy: target.cy, cellSpan, maxIter },
      out,
    );
    const ms = performance.now() - t0;
    handleResult(
      { id: -1, cols: grid.cols, rows: grid.rows, data: out, lo: stats.lo, hi: stats.hi, ms },
      { targetIndex, scale, cols: grid.cols, rows: grid.rows },
    );
  }

  function maybePostJob(): void {
    const target = TARGETS[targetIndex];
    const inHold = diveElapsed >= DIVE_SECONDS;
    // Scale is unchanging through the hold once we already have an
    // end-scale frame for this target: nothing new to compute.
    if (inHold && currentMeta && currentMeta.targetIndex === targetIndex && currentMeta.scale === target.endScale) {
      return;
    }
    if (workerHandle) {
      if (!workerIdle) return;
      postJobToWorker(target);
    } else {
      postJobFallback(target);
    }
  }

  function transitionToNextTarget(): void {
    outgoingBuffer = currentBuffer;
    targetIndex = (targetIndex + 1) % TARGETS.length;
    diveElapsed = 0;
    currentBuffer = null;
    currentMeta = null;
    emaTargetIndex = -1;
    dissolveActive = true;
    dissolveElapsed = 0;
  }

  function advanceTime(dtSeconds: number): void {
    diveElapsed += dtSeconds;
    if (dissolveActive) {
      dissolveElapsed += dtSeconds;
      if (dissolveElapsed >= DISSOLVE_SECONDS) {
        dissolveActive = false;
        outgoingBuffer = null;
      }
    }
    if (!dissolveActive && diveElapsed >= DIVE_SECONDS + HOLD_SECONDS) {
      transitionToNextTarget();
    }
  }

  function rerollGlyphs(): void {
    const rate = dissolveActive ? BASE_REROLL_RATE * DISSOLVE_REROLL_MULT : BASE_REROLL_RATE;
    const n = grid.cols * grid.rows;
    const count = Math.round(n * rate);
    for (let i = 0; i < count; i++) {
      const idx = Math.floor(Math.random() * n);
      grid.glyphIndices[idx] = Math.floor(Math.random() * GLYPHS.length);
    }
  }

  /** Main draw pass: blits one sprite per non-interior cell from the colour
   *  atlas instead of calling fillText, per the PERFORMANCE comment above
   *  COLOR_LEVELS. The counting-sort-by-bucket batching this replaced only
   *  existed to limit fillStyle churn, which drawImage doesn't have, so it's
   *  gone; crest detection below still needs the 128-bucket scale (that
   *  granularity is what palette.crestBucket is tuned against) but no
   *  longer needs the sort, just a threshold compare per cell. */
  function drawGlyphs(): void {
    const { cols, rows, cellSize, cssWidth, cssHeight, glyphIndices, dissolveThresholds } = grid;
    const n = cols * rows;

    ctx!.clearRect(0, 0, cssWidth, cssHeight);
    crestX.length = 0;
    crestY.length = 0;
    crestGlyph.length = 0;

    if (!colorAtlas) return;
    const { atlas, tile } = colorAtlas;
    const srcTile = Math.max(1, Math.round(tile * dpr));
    const half = tile / 2;

    const lastBucket = palette.stops.length - 1;
    const crestBucket = palette.crestBucket;
    const dissolving = dissolveActive && outgoingBuffer !== null && outgoingBuffer.length === n;
    const incoming = currentBuffer && currentBuffer.length === n ? currentBuffer : null;
    const p = dissolveElapsed / DISSOLVE_SECONDS;

    let index = 0;
    for (let row = 0; row < rows; row++) {
      const py = row * cellSize + cellSize / 2;
      for (let col = 0; col < cols; col++, index++) {
        let v: number;
        if (dissolving) {
          const useIncoming = dissolveThresholds[index] < p;
          v = useIncoming ? (incoming ? incoming[index] : INTERIOR) : outgoingBuffer![index];
        } else if (incoming) {
          v = incoming[index];
        } else {
          v = INTERIOR;
        }
        if (v === INTERIOR) continue;

        const px = col * cellSize + cellSize / 2;
        const glyph = glyphIndices[index];
        const level = Math.min(COLOR_LEVELS - 1, Math.floor(v * COLOR_LEVELS));
        ctx!.drawImage(
          atlas,
          glyph * srcTile,
          level * srcTile,
          srcTile,
          srcTile,
          px - half,
          py - half,
          tile,
          tile,
        );

        if (clampBucket(v, lastBucket) >= crestBucket) {
          crestX.push(px);
          crestY.push(py);
          crestGlyph.push(glyph);
        }
      }
    }

    if (crestX.length > 0 && glow) {
      drawCrests(ctx!, glow, dpr, crestX, crestY, crestGlyph);
    }
  }

  function drawFrame(): void {
    const t0 = performance.now();
    rerollGlyphs();
    drawGlyphs();
    lastDrawMs = performance.now() - t0;
    frames++;
  }

  function renderStaticFrame(): void {
    // Reduced motion: one fixed frame, TARGETS[0] at the geometric midpoint
    // of its own dive, computed synchronously (no worker churn, no loop).
    // Fixed glyph identities: rerollGlyphs is deliberately not called.
    const target = TARGETS[0];
    const scale = Math.sqrt(target.startScale * target.endScale);
    const cellSpan = scale / grid.cols;
    const maxIter = maxIterFor(target.startScale, scale);
    const out = new Float32Array(grid.cols * grid.rows);
    const stats = computeField(
      { cols: grid.cols, rows: grid.rows, cx: target.cx, cy: target.cy, cellSpan, maxIter },
      out,
    );
    mapBrightness(out, stats.lo, stats.hi);

    dissolveActive = false;
    outgoingBuffer = null;
    currentBuffer = out;
    currentMeta = { targetIndex: 0, scale, cols: grid.cols, rows: grid.rows };

    drawGlyphs();
  }

  function loop(now: number): void {
    if (!running) return;
    const dt = lastFrameTime === null ? 0 : (now - lastFrameTime) / 1000;
    lastFrameTime = now;
    advanceTime(dt);
    maybePostJob();
    drawFrame();
    rafId = requestAnimationFrame(loop);
  }

  function startLoopIfNeeded(): void {
    if (reduced || destroyed || !active) return;
    if (running) return;
    if (!isIntersecting || document.hidden) return;
    running = true;
    lastFrameTime = null;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop(): void {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    // Elapsed dive/dissolve time must pause with the loop (not accumulate
    // via wall clock), so lastFrameTime is reset only when the loop resumes
    // (startLoopIfNeeded sets it to null), never here.
  }

  function handleResize(): void {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeCanvasToDisplaySize();
      if (reduced) renderStaticFrame();
    }, RESIZE_DEBOUNCE_MS);
  }

  function handleVisibilityChange(): void {
    if (document.hidden) stopLoop();
    else startLoopIfNeeded();
  }

  const io = new IntersectionObserver(
    (entries) => {
      const entry = entries[0];
      if (!entry) return;
      isIntersecting = entry.isIntersecting;
      if (isIntersecting) startLoopIfNeeded();
      else stopLoop();
    },
    { threshold: 0 },
  );

  // --- initial setup -------------------------------------------------
  resizeCanvasToDisplaySize();

  const unsubscribeReducedMotion = onReducedMotionChange((isReduced) => {
    reduced = isReduced;
    if (reduced) {
      stopLoop();
      renderStaticFrame();
    } else {
      lastFrameTime = null;
      startLoopIfNeeded();
    }
  });

  window.addEventListener("resize", handleResize);
  document.addEventListener("visibilitychange", handleVisibilityChange);
  io.observe(canvas);

  if (reduced) {
    renderStaticFrame();
  } else {
    startLoopIfNeeded();
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    stopLoop();
    window.clearTimeout(resizeTimer);
    window.removeEventListener("resize", handleResize);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    io.disconnect();
    unsubscribeReducedMotion();
    window.removeEventListener("astro:before-swap", destroy);
    if (workerHandle) {
      workerHandle.terminate();
      workerHandle = null;
    }
    instances.delete(canvas);
  }

  window.addEventListener("astro:before-swap", destroy, { once: true });

  const handle: MandelbrotFieldHandle = {
    destroy,
    setActive(a: boolean) {
      active = a;
      if (active) startLoopIfNeeded();
      else stopLoop();
    },
    stats(): MandelbrotFieldStats {
      return {
        frames,
        lastDrawMs,
        lastJobMs,
        target: TARGETS[targetIndex].name,
        scale: currentMeta ? currentMeta.scale : TARGETS[targetIndex].startScale,
      };
    },
  };
  instances.set(canvas, handle);
  return handle;
}
