/**
 * Glyph kit: the alphabet, colour ramp and bloom sprite atlas shared by every
 * glyph-rendering engine on the site (the background field and the homepage
 * hero's Mandelbrot engine). Extracted from `glyph-field.ts` so both engines
 * draw from the identical character set, ramp and glow sprites rather than
 * keeping two copies that could drift apart.
 */

/*
  The full set is the point. A two-glyph field was tried on 2026-08-29 and
  rejected on sight: at this density a repeating pair reads as wallpaper, not
  as working. The variety is what makes it scan as mathematics rather than as
  a texture, so the whole alphabet stays. What DID survive from that pass is
  the size, see MIN_CELL_PX / FONT_RATIO below: the glyphs are drawn wider
  than the original, they are just no longer only two of them.
*/
export const GLYPHS = [
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

export const FONT_FALLBACK =
  '"JetBrains Mono Variable", ui-monospace, "SFMono-Regular", Menlo, monospace';
export const FONT_RATIO = 0.72; // glyph font-size as a fraction of the cell pitch

export interface Palette {
  /** Brightness bucket at/above which a cell is a "crest" and gets the
   *  additive bloom pass. Stored on the palette so it moves with the ramp. */
  crestBucket: number;
  /** Precomputed rgba() strings, indexed by a quantized brightness bucket,
   *  so the render loop never allocates a color string per cell per frame. */
  stops: string[];
}

export function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export function hexToRgb(hex: string): [number, number, number] {
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

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpRgb(
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
export function buildPalette(): Palette {
  const faint = hexToRgb(readCssVar("--color-faint", "#52525B"));
  const muted = hexToRgb(readCssVar("--color-muted", "#8A8A93"));
  const accent = hexToRgb(readCssVar("--color-accent", "#4ADE80"));
  const bloomHot = hexToRgb(readCssVar("--color-bloom-hot", "#86EFAC"));

  const size = 128;
  const stops = new Array<string>(size);

  // Vibrancy pass (owner asked for a more vibrant hero, same mechanic).
  // The ramp is now three segments instead of two, with the accent band
  // starts much earlier, so a far larger share of the field carries colour
  // rather than sitting in the grey-green floor.
  const mutedAt = 0.42; // was 0.62, accent now begins far sooner
  const hotAt = 0.86; // top of the ramp blooms past accent into bloom-hot

  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    let rgb: [number, number, number];
    let alpha: number;

    if (t < mutedAt) {
      const localT = t / mutedAt;
      rgb = lerpRgb(faint, muted, localT);
      alpha = lerp(0.14, 0.42, localT);
    } else if (t < hotAt) {
      const localT = (t - mutedAt) / (hotAt - mutedAt);
      // Gentler curve than before (1.6 -> 1.15) so the climb to accent is
      // a broad glow rather than a spike confined to rare crests.
      rgb = lerpRgb(muted, accent, Math.pow(localT, 1.15));
      alpha = lerp(0.42, 0.88, localT);
    } else {
      const localT = (t - hotAt) / (1 - hotAt);
      rgb = lerpRgb(accent, bloomHot, localT);
      alpha = lerp(0.88, 1, localT);
    }

    stops[i] = `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${alpha.toFixed(3)})`;
  }

  return { stops, crestBucket: Math.floor(hotAt * (size - 1)) };
}

export interface GlowAtlas {
  atlas: HTMLCanvasElement;
  tile: number;
  key: string;
}

/**
 * PERFORMANCE: the additive bloom used to call `fillText` once per crest
 * cell with `ctx.shadowBlur` set. Canvas shadow blur is applied per draw
 * call and is not cheap: measured on a 1920x1080 grid it cost 2.9ms for
 * 10% of cells and 6.8ms for 25%, against a 16.7ms frame budget, while
 * the same glyphs drawn without a shadow cost 0.33ms. Because the number
 * of crests rises and falls as the field animates, that cost pulsed, so
 * the page hitched intermittently rather than running uniformly slowly.
 *
 * Each glyph's glow is identical every time it is drawn, so it is now
 * rendered once into a sprite sheet and blitted with drawImage. The blur
 * happens GLYPHS.length times per resize instead of hundreds of times per
 * frame, and the visual result is the same.
 *
 * The sheet is built at device resolution and drawn back at CSS size, so
 * it stays sharp on hidpi displays instead of being upscaled.
 *
 * Returns `previous` unchanged when the cache key still matches (same
 * caching semantics the field used when this lived as its own closure), and
 * null if a 2d context can't be obtained.
 */
export function buildGlowAtlas(
  cellSize: number,
  dpr: number,
  fontFamily: string,
  previous: GlowAtlas | null,
): GlowAtlas | null {
  const blur = cellSize * 0.9;
  const fontSize = cellSize * FONT_RATIO;
  // Room for the glow to fall off on every side before the tile is cut.
  const tile = Math.ceil(fontSize + blur * 3);
  const accent = readCssVar("--color-accent", "#4ADE80");
  const bloom = readCssVar("--color-bloom-hot", "#86EFAC");
  // Colours are part of the key so a token change invalidates the sheet
  // rather than leaving stale glows baked in.
  const key = `${tile}|${dpr}|${fontFamily}|${accent}|${bloom}`;
  if (previous && previous.key === key) return previous;

  const sheet = document.createElement("canvas");
  sheet.width = Math.max(1, Math.round(tile * dpr) * GLYPHS.length);
  sheet.height = Math.max(1, Math.round(tile * dpr));
  const sheetCtx = sheet.getContext("2d");
  if (!sheetCtx) return null;

  sheetCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sheetCtx.font = `${fontSize}px ${fontFamily}`;
  sheetCtx.textAlign = "center";
  sheetCtx.textBaseline = "middle";
  sheetCtx.fillStyle = accent;
  sheetCtx.shadowColor = bloom;
  sheetCtx.shadowBlur = blur;
  for (let i = 0; i < GLYPHS.length; i++) {
    sheetCtx.fillText(GLYPHS[i], i * tile + tile / 2, tile / 2);
  }

  return { atlas: sheet, tile, key };
}

/**
 * Additive bloom pass: crests are drawn a second time with 'lighter', which
 * sums into the pixels already there. That is what makes the brightest
 * cells actually glow rather than just being a lighter green. Shared so
 * every glyph-rendering engine gets the identical bloom, not a near-copy.
 */
export function drawCrests(
  ctx: CanvasRenderingContext2D,
  glow: GlowAtlas,
  dpr: number,
  xs: number[],
  ys: number[],
  glyphs: number[],
  alpha = 0.5,
): void {
  if (xs.length === 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = alpha;
  // Blit the pre-blurred sprite instead of re-running shadowBlur per
  // glyph. Source rect is in device pixels (the sheet's own space),
  // destination in CSS pixels, which the canvas transform scales back
  // up to exactly 1:1 on device pixels.
  const srcTile = Math.round(glow.tile * dpr);
  const half = glow.tile / 2;
  for (let i = 0; i < xs.length; i++) {
    ctx.drawImage(
      glow.atlas,
      glyphs[i] * srcTile,
      0,
      srcTile,
      srcTile,
      xs[i] - half,
      ys[i] - half,
      glow.tile,
      glow.tile,
    );
  }
  ctx.restore();
}
