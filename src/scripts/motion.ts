/**
 * Motion system — Lenis smooth scroll wired to GSAP ScrollTrigger.
 *
 * Owned by Wave 1 Agent C. This is the ONLY place Lenis/GSAP get
 * instantiated; `Hero.astro` and any future page that wants the smooth
 * scroll + scrubbed-animation combo imports `initSmoothScroll` from here
 * rather than standing up its own Lenis instance.
 *
 * PLAN.md §4 / CLAUDE.md §5: `prefers-reduced-motion` gets a REAL static
 * fallback, not a shortened duration. When the media query matches, this
 * module never constructs Lenis and never starts a rAF loop — the browser's
 * native scroll stands untouched, so there is nothing to "trap" scroll-jack
 * style. Callers that also drive their own canvas loops (GlyphField) must
 * make the same check independently; `prefersReducedMotion()` /
 * `onReducedMotionChange()` are exported for that.
 */

import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";

let pluginsRegistered = false;

function ensurePlugins(): void {
  if (pluginsRegistered) return;
  gsap.registerPlugin(ScrollTrigger);
  pluginsRegistered = true;
}

/** True when the user has asked the OS/browser for reduced motion. */
const velocitySubscribers = new Set<(v: number) => void>();

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Subscribes to live changes of the reduced-motion preference (some OSes
 * let a user flip this without a reload). Returns an unsubscribe function.
 */
export function onReducedMotionChange(
  callback: (reduced: boolean) => void,
): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const handler = () => callback(mq.matches);
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}

let lenis: Lenis | null = null;
let tickerCallback: ((time: number) => void) | null = null;
let swapListenerAttached = false;

/**
 * Initializes smooth scroll (Lenis) driven by the GSAP ticker, and keeps
 * ScrollTrigger in sync with Lenis's virtual scroll position. Idempotent —
 * calling it again while already active just returns the existing teardown.
 *
 * Under `prefers-reduced-motion: reduce` this is a deliberate no-op: no
 * Lenis instance, no rAF loop, native scroll behavior untouched. Callers
 * should still call `ScrollTrigger.refresh()`-dependent code normally;
 * ScrollTrigger works fine against native scroll with no Lenis attached.
 *
 * Returns a cleanup function. Also self-registers cleanup on
 * `astro:before-swap` so View Transitions never leak a running rAF loop
 * or a stale Lenis instance across a page swap.
 */
export function initSmoothScroll(): () => void {
  ensurePlugins();

  if (prefersReducedMotion()) {
    return () => {};
  }

  if (lenis) {
    return teardown;
  }

  lenis = new Lenis({
    autoRaf: false,
    smoothWheel: true,
  });

  lenis.on("scroll", ScrollTrigger.update);

  // Broadcast scroll velocity so decorative layers can react with inertia.
  // Lenis reports velocity directly, which is far steadier than
  // differencing scrollY by hand across frames.
  lenis.on("scroll", (e: { velocity: number }) => {
    for (const fn of velocitySubscribers) fn(e.velocity);
  });

  tickerCallback = (time: number) => {
    // gsap.ticker reports elapsed time in seconds; lenis.raf wants ms.
    lenis?.raf(time * 1000);
  };
  gsap.ticker.add(tickerCallback);
  gsap.ticker.lagSmoothing(0);

  if (!swapListenerAttached) {
    window.addEventListener("astro:before-swap", teardown, { once: true });
    swapListenerAttached = true;
  }

  return teardown;
}

function teardown(): void {
  if (tickerCallback) {
    gsap.ticker.remove(tickerCallback);
    tickerCallback = null;
  }
  if (lenis) {
    lenis.destroy();
    lenis = null;
  }
  swapListenerAttached = false;
}

/** Shared gsap/ScrollTrigger handles for the other motion files to reuse
 *  without each registering the plugin separately. */
/**
 * Subscribe to smooth-scroll velocity. Returns an unsubscribe function.
 * Emits nothing under reduced motion (Lenis is never constructed), so
 * consumers automatically fall still rather than needing their own guard.
 */
export function onScrollVelocity(fn: (v: number) => void): () => void {
  velocitySubscribers.add(fn);
  return () => velocitySubscribers.delete(fn);
}

export { gsap, ScrollTrigger };
