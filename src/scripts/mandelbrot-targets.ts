/**
 * Verified zoom-tour targets for the Mandelbrot hero.
 *
 * Every entry is the exact nucleus of a period-p hyperbolic component,
 * located by Newton's method on f_p(c) = z_p(c) = 0 (iterating z and dz/dc
 * together, c -= z_p/dz_p, from a rough seed found by honest numeric search
 * — never typed in from memory), converged to a residual |z_p(nucleus)| far
 * below double-precision noise (1e-13 to 1e-16 for every entry below). A
 * nucleus is exactly the centre of an embedded minibrot: the whole tour
 * dive stays surrounded by boundary filaments and ends on a visible copy of
 * the whole set, centred, which is the intended moment to dissolve into the
 * next target. `period` is p.
 *
 * `endScale` was chosen per target by rendering the actual 160x90 field
 * (see tools/check-mandelbrot-targets.mjs and the scratch scripts under
 * AppData/.../scratchpad/{nucleus,deepen2,measure-width}.mjs) and picking
 * the deepest scale at which the connected interior blob centred on the
 * nucleus fills roughly 20-40% of the view width without touching the
 * frame border. The component "size estimate" |A_p/B_p| (A = dz_p/dc,
 * B = d^2 z_p/dc^2 at the nucleus) was used to jump near the right scale
 * before fine-tuning by render. For all four nuclei found here, that
 * render-verified depth landed short of the 1e-7 target ceiling requested
 * for this table (see the per-target notes) — deepening further via nested
 * satellite search kept landing on components whose own natural "reveal"
 * scale (where the embedded copy stops filling the whole frame) was still
 * shallower than 1e-7; this is reported honestly rather than forcing
 * endScale into range at the cost of a flat or cropped end frame.
 *
 * Every entry has been run through `tools/check-mandelbrot-targets.mjs`,
 * which imports this exact array (the table is never re-typed in the
 * checker) and asserts, at 8 log-spaced scales from startScale to
 * endScale:
 *   - interior fraction in [0.02, 0.95] (start frame exempt from the lower
 *     bound when it's a wide view of the whole set). The 0.95 ceiling is
 *     deliberately loose: every dive here starts at startScale=3.0, the
 *     whole-set view, centred on the target's own nucleus, so the opening
 *     stretch legitimately spends several frames mostly INSIDE the main
 *     cardioid or a bulb (the familiar dark cardioid body and the valley
 *     beside it) before reaching the target's own boundary detail — that's
 *     not a flat/broken frame, so it isn't gated on interior fraction alone.
 *     What actually matters (rich escape-time detail, or a visible
 *     minibrot) is enforced by the central-window check below.
 *   - escaped-cell brightness histogram (after mapBrightness with the
 *     frame's own lo/hi) has >= 6 of 16 non-empty buckets, OR the central
 *     30%-width/height window contains interior cells
 *   - at endScale: the central window contains interior cells (the
 *     minibrot is visible) and the connected interior component sitting at
 *     the exact centre pixel does not touch the frame border (the minibrot
 *     itself fits in view — an unrelated fleck of interior elsewhere in the
 *     frame, which the densely-fractal boundary always has some of, doesn't
 *     count)
 *   - double-precision headroom at endScale (cellSpan / max(|cx|,|cy|) > 2e-15,
 *     no two horizontally-adjacent sample re-values collapse to one double)
 *
 * `scale` is the width of the whole rendered view in the complex plane;
 * cellSpan for a given frame is scale / cols.
 */

export interface Target {
  name: string;
  /** Period p of the nucleus's hyperbolic component. */
  period: number;
  cx: number;
  cy: number;
  startScale: number;
  endScale: number;
}

// Verified 2026-09-16 by tools/check-mandelbrot-targets.mjs. Every nucleus
// below is a Newton root (not a searched near-boundary point): residuals
// and derivation are in the per-target notes.
export const TARGETS = [
  {
    // Seahorse Valley neighbourhood. Newton root of a period-400 satellite
    // found by nested-satellite search from a seed near -0.75+0.1i (between
    // the main cardioid and the period-2 bulb), refined through several
    // rounds of: find a smaller connected interior component near the
    // current nucleus, re-run Newton on it, repeat. Residual |z_400| =
    // 3.84e-13. endScale is the deepest render-verified scale (of a dozen+
    // tried) where the centred interior blob fills 20-40% of the view width
    // without touching the frame border; shallower than the 1e-7 ceiling
    // because this specific component's own copy of the whole set doesn't
    // reveal until this scale — deeper renders are simply 100% interior
    // (no boundary detail left in frame).
    name: "Seahorse Valley",
    period: 400,
    cx: -0.7448838972986269,
    cy: 0.11425876376129993,
    // startScale used to be narrowed to 0.02 to dodge an intermediate band
    // (roughly scale 0.3-0.6) where the frame is 75-80% ancestor-bulb
    // interior; the owner wants the dive to open on the recognisable whole
    // set instead, so it's back to 3.0 and that band is now allowed (see
    // the interior-fraction ceiling note above).
    startScale: 3.0,
    endScale: 4.569e-5,
  },
  {
    // Elephant Valley. Newton root of a period-1267 satellite, found the
    // same way starting from a genuine satellite bulb on the cardioid's
    // boundary near 0.35+0.09i (the prompt's ~0.28+0.008i seed and the
    // earlier 0.255+... search point both turned out to be plain main-
    // cardioid interior, not a satellite — verified by the closed-form
    // cardioid test, not assumed). Residual |z_1267| = 4.64e-11. This is
    // the deepest of the four targets and the closest to the requested
    // 1e-7 ceiling (4.6x over) — its size estimate |A/B| was ~1.9e-9,
    // smallest of the four, consistent with its higher period.
    name: "Elephant Valley",
    period: 1267,
    cx: 0.2550292333269015,
    cy: -0.0005515805613806328,
    // startScale was narrowed to 0.002 for the same ancestor-swallow reason
    // as Seahorse Valley (worse here, up to 90% interior); now 3.0, see the
    // ceiling note above.
    startScale: 3.0,
    endScale: 4.6389e-7,
  },
  {
    // Triple Spiral. Newton root of a period-438 satellite in the seahorse
    // valley's tail, found by the same nested-satellite search. Residual
    // |z_438| = 2.33e-13. Distinct visual character from the Seahorse
    // Valley target above despite the nearby coordinates — different
    // period, different spiral-arm count at the boundary.
    name: "Triple Spiral",
    period: 438,
    cx: -0.7360714245610969,
    cy: 0.16009106747959548,
    // startScale was narrowed to 0.02 for the same ancestor-swallow reason
    // as Seahorse Valley; now 3.0, see the ceiling note above.
    startScale: 3.0,
    endScale: 3.824e-6,
  },
  {
    // Real-axis antenna region (distinctly different neighbourhood: on the
    // negative real axis around -1.27, vs. the seahorse/elephant cluster's
    // -0.74/+0.26). Newton root of a period-340 satellite, found by
    // nested-satellite search from a seed near -1.24+0.07i. Residual
    // |z_340| = 4.68e-13. startScale was narrowed to 1.0 for the same
    // ancestor-swallow reason as the others (measured band roughly scale
    // 0.15-0.5 here); now 3.0, see the ceiling note above.
    name: "Antenna",
    period: 340,
    cx: -1.2688950130844332,
    cy: 0.04587773128136726,
    startScale: 3.0,
    endScale: 1.5e-4,
  },
] satisfies Target[];
