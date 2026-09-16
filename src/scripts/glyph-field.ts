/**
 * The glyph field: the site's signature background.
 *
 * NOT Matrix rain. Every cell in a monospace grid renders a mathematical
 * character whose BRIGHTNESS is driven by a real scalar field sampled over
 * the grid and over time:
 *
 *   f(x, y, t) = sin(a1*x + b1*t) * cos(c1*y + d1*t)
 *              + 0.6 * sin(a2*x + c2*y - b2*t)
 *              + 0.5 * cos(c3*y + b3*t) * sin(a3*x - d3*t)
 *              + 0.4 * sin((x + y) * a4 + b4*t)
 *
 * i.e. a sum of a few sinusoids at different spatial frequencies and phase
 * velocities. The interference pattern between the terms sweeps across the
 * screen like a live computation rather than a scripted animation. Glyph
 * *identity* is a separate, much slower process: a small fraction of cells
 * re-roll to a new random character each frame, so the field reads as
 * "thinking" instead of "raining."
 *
 * Owned by Wave 1 Agent C. Consumed by `GlyphField.astro`.
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
  type GlowAtlas,
} from "./glyph-kit";

/** Target cell count on a large monitor stays well under the ~8k budget;
 *  cell pitch grows with viewport area so small screens stay legible and
 *  huge screens don't blow the grid up. */
/* Owner decision 2026-08-29: wider glyphs, but NOT a sparser field.
   An earlier pass cut the grid to 620 cells and the background lost the dense
   "sheet of working" quality that made it read as mathematics at all. Density
   is back near the original 2200 while each glyph is drawn about 32% larger
   than before (a ~19px glyph on a 26.8px pitch at 1440x900, against the old
   ~14.6px on 24.3px), which is what "wider" was asking for. */
const TARGET_CELLS = 1800;
const MIN_CELL_PX = 22;
const MAX_DPR = 2;
const REROLL_RATE = 0.006; // fraction of cells whose glyph re-rolls per frame
const RESIZE_DEBOUNCE_MS = 150;

/** The scalar field. nx/ny are grid-normalized coordinates (roughly the
 *  column/row index scaled down), t is elapsed seconds. Returns a value
 *  normalized to [0, 1]. */
function fieldValue(nx: number, ny: number, t: number): number {
  const v =
    Math.sin(nx * 1.0 + t * 0.35) * Math.cos(ny * 0.85 - t * 0.22) +
    0.6 * Math.sin(nx * 1.7 + ny * 0.55 - t * 0.18) +
    0.5 * Math.cos(ny * 1.45 + t * 0.27) * Math.sin(nx * 0.65 - t * 0.4) +
    0.4 * Math.sin((nx + ny) * 0.95 + t * 0.15);

  // Sum of coefficients bounds |v| <= 2.5; normalize to roughly [-1, 1].
  const signed = v / 2.5;
  // Mild contrast curve so crests separate cleanly from the mid-field.
  const shaped = Math.sign(signed) * Math.pow(Math.abs(signed), 0.85);
  return Math.min(1, Math.max(0, (shaped + 1) / 2));
}

interface Grid {
  cols: number;
  rows: number;
  cellSize: number;
  cssWidth: number;
  cssHeight: number;
  glyphIndices: Uint8Array;
}

function computeGrid(cssWidth: number, cssHeight: number, previous: Grid | null): Grid {
  const area = Math.max(1, cssWidth * cssHeight);
  const rawCell = Math.sqrt(area / TARGET_CELLS);
  const cellSize = Math.max(rawCell, MIN_CELL_PX);
  const cols = Math.max(1, Math.ceil(cssWidth / cellSize) + 1);
  const rows = Math.max(1, Math.ceil(cssHeight / cellSize) + 1);
  const count = cols * rows;

  const glyphIndices = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    glyphIndices[i] = Math.floor(Math.random() * GLYPHS.length);
  }
  void previous; // grid is cheap enough to fully rebuild on resize

  return { cols, rows, cellSize, cssWidth, cssHeight, glyphIndices };
}

export interface GlyphFieldHandle {
  destroy(): void;
  /** Feed scroll velocity (px/frame-ish) so the field reacts with inertia. */
  setVelocity(v: number): void;
  /** 0..1 global intensity. Lets the field thin out below the hero. */
  setIntensity(v: number): void;
}

export function initGlyphField(canvas: HTMLCanvasElement): GlyphFieldHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { destroy() {}, setVelocity() {}, setIntensity() {} };
  }

  let reduced = prefersReducedMotion();
  let palette = buildPalette();
  let grid = computeGrid(
    canvas.clientWidth || window.innerWidth,
    canvas.clientHeight || window.innerHeight,
    null,
  );

  let dpr = 1;
  let running = false;
  let rafId: number | null = null;
  let isIntersecting = true;
  let destroyed = false;
  let resizeTimer: number | undefined;
  let startTime = performance.now();
  // Physics coupling: raw scroll velocity is fed in from Lenis, but the
  // field reacts to a DAMPED copy of it. The damping is what makes it read
  // as mass: the field keeps drifting briefly after the scroll stops and
  // eases in rather than snapping to each new velocity.
  let velocityTarget = 0;
  let velocityDamped = 0;
  let intensity = 1;

  // Font family and the glow sprite sheet are resolved on resize, not per
  // frame. Both used to be recomputed inside drawFrame, which meant a
  // getComputedStyle call and a full shadow-blur setup on every tick.
  let fontFamily = FONT_FALLBACK;
  let glow: GlowAtlas | null = null;

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
    // Draws happen in CSS-pixel coordinates; the transform handles DPR.
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    grid = computeGrid(cssWidth, cssHeight, grid);
    fontFamily = readCssVar("--font-mono", FONT_FALLBACK);
    glow = buildGlowAtlas(grid.cellSize, dpr, fontFamily, glow);
  }

  function drawFrame(elapsedSeconds: number): void {
    const { cols, rows, cellSize, cssWidth, cssHeight, glyphIndices } = grid;

    ctx!.clearRect(0, 0, cssWidth, cssHeight);
    // Global intensity: 1 in the hero, lower further down the page so the
    // field persists without ever competing with body text.
    ctx!.globalAlpha = intensity;

    const fontSize = cellSize * FONT_RATIO;
    ctx!.font = `${fontSize}px ${fontFamily}`;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";

    // Sparse, slow glyph identity churn, independent of the brightness
    // field, which updates every frame. Only a small fraction of cells
    // re-roll per frame, so the field reads as "thinking," not raining.
    const cellCount = cols * rows;
    const rerollCount = Math.round(cellCount * REROLL_RATE);
    for (let i = 0; i < rerollCount; i++) {
      const idx = Math.floor(Math.random() * cellCount);
      glyphIndices[idx] = Math.floor(Math.random() * GLYPHS.length);
    }

    // Ease the damped velocity toward the latest reading. Critically damped
    // enough that a flick imparts drift which decays over ~0.5s instead of
    // tracking the scroll 1:1 (which would read as a glitch, not as mass).
    velocityDamped += (velocityTarget - velocityDamped) * 0.08;
    // Clamp so a violent fling can't shear the field into nonsense.
    const shear = Math.max(-1, Math.min(1, velocityDamped / 45));

    const lastBucket = palette.stops.length - 1;
    const crestBucket = palette.crestBucket;
    // Crest cells are collected during the main pass and re-drawn additively
    // afterwards. Two passes with one composite switch beats switching
    // globalCompositeOperation per cell.
    const crestX: number[] = [];
    const crestY: number[] = [];
    const crestGlyph: number[] = [];

    let index = 0;
    for (let row = 0; row < rows; row++) {
      const ny = (row / rows - 0.5) * 10;
      // Scroll velocity displaces the sampling position vertically, so the
      // pattern lags behind fast scrolling and settles when you stop.
      const nyShear = ny + shear * 1.4;
      const py = row * cellSize + cellSize / 2;
      for (let col = 0; col < cols; col++, index++) {
        const nx = (col / cols - 0.5) * 10;
        const brightness = fieldValue(nx, nyShear, elapsedSeconds);
        const bucket = Math.min(lastBucket, Math.max(0, Math.floor(brightness * lastBucket)));
        ctx!.fillStyle = palette.stops[bucket];
        const px = col * cellSize + cellSize / 2;
        const glyph = glyphIndices[index];
        ctx!.fillText(GLYPHS[glyph], px, py);

        if (bucket >= crestBucket) {
          crestX.push(px);
          crestY.push(py);
          crestGlyph.push(glyph);
        }
      }
    }

    // Additive bloom: crests are drawn a second time with 'lighter', shared
    // with every glyph-rendering engine so the bloom pass is identical.
    if (crestX.length > 0 && glow) {
      drawCrests(ctx!, glow, dpr, crestX, crestY, crestGlyph);
    }
  }

  function renderStaticFrame(): void {
    // Intensity 0 under reduced motion: nothing would be visible anyway, so
    // just clear rather than paying for a static draw that's fully transparent.
    if (intensity <= 0) {
      ctx!.clearRect(0, 0, grid.cssWidth, grid.cssHeight);
      return;
    }
    // A single, fixed frame: never a shortened animation. Pick a
    // non-trivial t so the static field looks intentional, not flat.
    drawFrame(6.283);
  }

  function loop(now: number): void {
    if (!running) return;
    const elapsed = (now - startTime) / 1000;
    drawFrame(elapsed);
    rafId = requestAnimationFrame(loop);
  }

  function startLoopIfNeeded(): void {
    if (reduced || destroyed) return;
    if (running) return;
    if (!isIntersecting || document.hidden) return;
    // Intensity 0 means the field has been asked to stay off: see the
    // comment on setIntensity. Nothing should wake it back up until
    // intensity rises again.
    if (intensity <= 0) return;
    running = true;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop(): void {
    running = false;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  function handleResize(): void {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      resizeCanvasToDisplaySize();
      palette = buildPalette();
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
      startTime = performance.now();
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
  }

  window.addEventListener("astro:before-swap", destroy, { once: true });

  return {
    destroy,
    setVelocity(v: number) {
      velocityTarget = v;
      // A moving field must keep drawing even if the brightness animation
      // is otherwise idle, so make sure the loop is alive while scrolling.
      startLoopIfNeeded();
    },
    setIntensity(v: number) {
      const next = Math.max(0, Math.min(1, v));
      const wasZero = intensity <= 0;
      intensity = next;
      // The homepage hero now sometimes covers the field with an opaque
      // fractal layer and holds field intensity at 0 for as long as that
      // layer is up. Without this the field would keep computing a full
      // grid every frame behind something fully opaque, for nothing.
      if (intensity <= 0) {
        if (!wasZero) {
          stopLoop();
          ctx!.clearRect(0, 0, grid.cssWidth, grid.cssHeight);
        }
      } else if (wasZero) {
        if (reduced) renderStaticFrame();
        else startLoopIfNeeded();
      }
    },
  };
}
