/**
 * Generates public/og.png, the 1200x630 card that link previews show.
 *
 * Committed as a script rather than as a one-off so the image is reproducible:
 * if the name, tagline or palette changes, re-run it instead of hand-editing a
 * binary nobody can diff.
 *
 *   node tools/generate-og.mjs
 *
 * The artwork is the site's own geometry, not a stock gradient. Cell
 * brightness comes from the same summed-sinusoid field the hero canvas
 * evaluates per frame (src/scripts/glyph-field.ts), sampled once here at a
 * fixed t. The palette is read from the locked tokens so the card can never
 * drift from the site.
 *
 * Type is set in a monospace family rather than Space Grotesk: the display
 * face ships as woff2 through Fontsource and the SVG rasteriser resolves
 * families by system name, so it cannot see it. Mono is the site's dominant
 * typeface anyway, so the card stays on identity.
 */
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

const W = 1200;
const H = 630;

// Locked tokens, mirrored from src/styles/global.css.
const GROUND = "#0A0A0B";
const BRIGHT = "#F4F4F5";
const MUTED = "#8A8A93";
const FAINT = "#52525B";
const ACCENT = "#4ADE80";
const ACCENT_DIM = "#22C55E";
const BLOOM_HOT = "#86EFAC";

const NAME = "Marc Godbout-Chouinard";
const TAGLINE = "BS Computer Science and MS Artificial Intelligence at WPI, 2027";
const KICKER = "ML RESEARCH  ·  APPLIED SYSTEMS  ·  PORTFOLIO";

const GLYPHS = "∑∫∂√πλΣ∇⊗≈≠≤≥±∞µΩθφψΔ∈∀∃⊂∪∩".split("");

/** Same field as the canvas: summed, phase-shifted sinusoids. */
function fieldValue(nx, ny, t) {
  const v =
    Math.sin(nx * 1.0 + t * 0.35) * Math.cos(ny * 0.85 - t * 0.22) +
    0.6 * Math.sin(nx * 1.7 + ny * 0.55 - t * 0.18) +
    0.5 * Math.cos(ny * 1.45 + t * 0.27) * Math.sin(nx * 0.65 - t * 0.4) +
    0.4 * Math.sin((nx + ny) * 0.95 + t * 0.15);
  const signed = v / 2.5;
  const shaped = Math.sign(signed) * Math.pow(Math.abs(signed), 0.85);
  return Math.min(1, Math.max(0, (shaped + 1) / 2));
}

// Deterministic glyph choice. No Math.random, so the card is byte-identical
// on every run.
function glyphAt(col, row) {
  const h = (col * 73856093) ^ (row * 19349663);
  return GLYPHS[Math.abs(h) % GLYPHS.length];
}

const CELL = 30;
const COLS = Math.ceil(W / CELL);
const ROWS = Math.ceil(H / CELL);
const T = 6.283;

let cells = "";
for (let row = 0; row < ROWS; row++) {
  const ny = (row / ROWS - 0.5) * 10;
  for (let col = 0; col < COLS; col++) {
    const nx = (col / COLS - 0.5) * 10;
    const b = fieldValue(nx, ny, T);
    let fill;
    let opacity;
    if (b < 0.42) {
      fill = FAINT;
      opacity = 0.1 + b * 0.5;
    } else if (b < 0.86) {
      fill = ACCENT_DIM;
      opacity = 0.28 + (b - 0.42) * 0.9;
    } else {
      fill = BLOOM_HOT;
      opacity = 0.75 + (b - 0.86) * 1.5;
    }
    const x = col * CELL + CELL / 2;
    const y = row * CELL + CELL / 2;
    cells +=
      `<text x="${x}" y="${y}" font-size="17" fill="${fill}" ` +
      `fill-opacity="${opacity.toFixed(2)}" text-anchor="middle" ` +
      `dominant-baseline="middle" font-family="Consolas, 'DejaVu Sans Mono', monospace">` +
      `${glyphAt(col, row)}</text>`;
  }
}

// Scrim: the field has to stay legible as texture without ever competing with
// the name sitting on top of it.
const scrim =
  `<linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0%" stop-color="${GROUND}" stop-opacity="0.42"/>` +
  `<stop offset="42%" stop-color="${GROUND}" stop-opacity="0.80"/>` +
  `<stop offset="72%" stop-color="${GROUND}" stop-opacity="0.80"/>` +
  `<stop offset="100%" stop-color="${GROUND}" stop-opacity="0.60"/>` +
  `</linearGradient>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${scrim}</defs>
  <rect width="${W}" height="${H}" fill="${GROUND}"/>
  <g>${cells}</g>
  <rect width="${W}" height="${H}" fill="url(#scrim)"/>
  <rect x="0" y="0" width="${W}" height="3" fill="${ACCENT}" fill-opacity="0.85"/>
  <text x="80" y="250" font-size="24" fill="${ACCENT}" letter-spacing="4"
        font-family="Consolas, 'DejaVu Sans Mono', monospace">${KICKER}</text>
  <text x="80" y="360" font-size="76" fill="${BRIGHT}" font-weight="bold" letter-spacing="-1"
        font-family="Consolas, 'DejaVu Sans Mono', monospace">${NAME}</text>
  <text x="80" y="428" font-size="27" fill="${MUTED}"
        font-family="Consolas, 'DejaVu Sans Mono', monospace">${TAGLINE}</text>
  <text x="80" y="548" font-size="24" fill="${FAINT}"
        font-family="Consolas, 'DejaVu Sans Mono', monospace">marcgc.pages.dev</text>
</svg>`;

const out = path.join(process.cwd(), "public", "og.png");
fs.mkdirSync(path.dirname(out), { recursive: true });
const buf = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
fs.writeFileSync(out, buf);
const meta = await sharp(buf).metadata();
console.log(`wrote ${out}  ${meta.width}x${meta.height}  ${(buf.length / 1024).toFixed(1)} KB`);
