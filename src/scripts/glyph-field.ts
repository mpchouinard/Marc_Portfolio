/**
 * The glyph field — the site's signature background.
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

const GLYPHS = [
  "∑", // sum
  "∂", // partial
  "∇", // nabla
  "∫", // integral
  "∏", // product
  "π", // pi
  "λ", // lambda
  "θ", // theta
  "μ", // mu
  "σ", // sigma
  "∞", // infinity
  "≈", // approx
  "≠", // neq
  "≤", // leq
  "⊗", // otimes
  "∈", // in
  "∀", // forall
  "∃", // exists
  "ℝ", // R (reals)
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "+",
  "−",
  "×",
  "=",
];

/** Target cell count on a large monitor stays well under the ~8k budget;
 *  cell pitch grows with viewport area so small screens stay legible and
 *  huge screens don't blow the grid up. */
const TARGET_CELLS = 2200;
const MIN_CELL_PX = 18;
const MAX_DPR = 2;
const FONT_RATIO = 0.6; // glyph font-size as a fraction of the cell pitch
const REROLL_RATE = 0.006; // fraction of cells whose glyph re-rolls per frame
const RESIZE_DEBOUNCE_MS = 150;

interface Palette {
  /** Precomputed rgba() strings, indexed by a quantized brightness bucket,
   *  so the render loop never allocates a color string per cell per frame. */
  stops: string[];
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "").trim();
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const int = Number.parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpRgb(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

/**
 * Builds a lookup table of rgba() strings spanning faint -> muted -> accent.
 * Most of the range stays in the low-alpha faint/muted band; only the top
 * of the curve reaches toward the accent color, matching "let only the
 * crests of the field reach --color-accent" from the brief.
 */
function buildPalette(): Palette {
  const faint = hexToRgb(readCssVar("--color-faint", "#52525B"));
  const muted = hexToRgb(readCssVar("--color-muted", "#8A8A93"));
  const accent = hexToRgb(readCssVar("--color-accent", "#4ADE80"));

  const size = 128;
  const stops = new Array<string>(size);
  const midpoint = 0.62; // brightness value below which cells stay faint->muted

  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let rgb: [number, number, number];
    let alpha: number;

    if (t < midpoint) {
      const localT = t / midpoint;
      rgb = lerpRgb(faint, muted, localT);
      alpha = lerp(0.1, 0.3, localT);
    } else {
      const localT = (t - midpoint) / (1 - midpoint);
      // Sharpen the approach to accent so only genuine crests fully glow.
      rgb = lerpRgb(muted, accent, Math.pow(localT, 1.6));
      alpha = lerp(0.3, 0.78, localT);
    }

    stops[i] = `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${alpha.toFixed(3)})`;
  }

  return { stops };
}

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
}

export function initGlyphField(canvas: HTMLCanvasElement): GlyphFieldHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { destroy() {} };
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
  }

  function drawFrame(elapsedSeconds: number): void {
    const { cols, rows, cellSize, cssWidth, cssHeight, glyphIndices } = grid;

    ctx!.clearRect(0, 0, cssWidth, cssHeight);

    const fontFamily = readCssVar(
      "--font-mono",
      '"JetBrains Mono Variable", ui-monospace, "SFMono-Regular", Menlo, monospace',
    );
    const fontSize = cellSize * FONT_RATIO;
    ctx!.font = `${fontSize}px ${fontFamily}`;
    ctx!.textAlign = "center";
    ctx!.textBaseline = "middle";

    // Sparse, slow glyph identity churn — independent of the brightness
    // field, which updates every frame. Only a small fraction of cells
    // re-roll per frame, so the field reads as "thinking," not raining.
    const cellCount = cols * rows;
    const rerollCount = Math.round(cellCount * REROLL_RATE);
    for (let i = 0; i < rerollCount; i++) {
      const idx = Math.floor(Math.random() * cellCount);
      glyphIndices[idx] = Math.floor(Math.random() * GLYPHS.length);
    }

    const scaleX = 1.0;
    const scaleY = 1.0;
    let index = 0;
    for (let row = 0; row < rows; row++) {
      const ny = (row / rows - 0.5) * 10 * scaleY;
      const py = row * cellSize + cellSize / 2;
      for (let col = 0; col < cols; col++, index++) {
        const nx = (col / cols - 0.5) * 10 * scaleX;
        const brightness = fieldValue(nx, ny, elapsedSeconds);
        const bucket = Math.min(
          palette.stops.length - 1,
          Math.max(0, Math.floor(brightness * (palette.stops.length - 1))),
        );
        ctx!.fillStyle = palette.stops[bucket];
        const px = col * cellSize + cellSize / 2;
        ctx!.fillText(GLYPHS[glyphIndices[index]], px, py);
      }
    }
  }

  function renderStaticFrame(): void {
    // A single, fixed frame — never a shortened animation. Pick a
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

  return { destroy };
}
