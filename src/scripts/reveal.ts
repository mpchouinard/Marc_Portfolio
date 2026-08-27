/**
 * The reveal engine — implements the contract in CLAUDE.md §5.
 *
 * Markup opts in declaratively; no component writes its own observer:
 *
 *   data-reveal              -> rises --reveal-distance and fades in, once
 *   data-reveal-group        -> staggers its DIRECT [data-reveal] children
 *   data-reveal-delay="120"  -> extra per-element delay in ms
 *
 * Two invariants this file exists to guarantee:
 *
 * 1. NO-JS SAFETY. The hidden start state lives entirely under
 *    `html.js-reveal`, a class this module adds to <html> itself. If this
 *    script never runs — JS disabled, a bundle error, a crawler — nothing is
 *    ever hidden and the page reads exactly as it would without motion.
 *    There is deliberately no `opacity: 0` anywhere in static CSS.
 *
 * 2. REDUCED MOTION HIDES NOTHING. Under `prefers-reduced-motion: reduce`
 *    we do not set `js-reveal` at all, so every element renders in its final
 *    position immediately. That is a static fallback, not a shortened
 *    animation.
 *
 * The animation itself is a plain CSS transition (see Base.astro's style
 * block) rather than GSAP — these are one-shot opacity/transform tweens and
 * the compositor handles them without any JS on the frame path.
 */

import { prefersReducedMotion, onReducedMotionChange } from "./motion";

const REVEALED_CLASS = "is-revealed";
const ENABLED_CLASS = "js-reveal";

let observer: IntersectionObserver | null = null;
let unsubscribeReducedMotion: (() => void) | null = null;

function reveal(el: Element): void {
  el.classList.add(REVEALED_CLASS);
  // Drop the compositor hint once the transition is done; leaving
  // will-change on every revealed element permanently wastes memory.
  const clear = () => (el as HTMLElement).style.willChange = "";
  el.addEventListener("transitionend", clear, { once: true });
}

/**
 * Assigns stagger delays. A group staggers only its DIRECT [data-reveal]
 * children, so nesting groups doesn't compound into absurd delays.
 */
function assignDelays(root: ParentNode): void {
  const stagger = readMs("--reveal-stagger", 70);

  for (const group of Array.from(root.querySelectorAll("[data-reveal-group]"))) {
    const children = Array.from(group.children).filter((c) =>
      c.hasAttribute("data-reveal"),
    );
    children.forEach((child, i) => {
      const own = Number(child.getAttribute("data-reveal-delay") ?? 0);
      (child as HTMLElement).style.setProperty(
        "--reveal-delay",
        `${i * stagger + (Number.isFinite(own) ? own : 0)}ms`,
      );
    });
  }

  // Ungrouped elements honour their own explicit delay only.
  for (const el of Array.from(root.querySelectorAll("[data-reveal][data-reveal-delay]"))) {
    if (el.parentElement?.hasAttribute("data-reveal-group")) continue;
    const own = Number(el.getAttribute("data-reveal-delay"));
    if (Number.isFinite(own)) {
      (el as HTMLElement).style.setProperty("--reveal-delay", `${own}ms`);
    }
  }
}

function readMs(varName: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function initReveal(): void {
  teardownReveal();

  // Reduced motion: never enable the hidden state. Nothing to observe,
  // nothing to animate — the page is simply already in its final form.
  if (prefersReducedMotion()) {
    document.documentElement.classList.remove(ENABLED_CLASS);
    watchReducedMotion();
    return;
  }

  const targets = Array.from(document.querySelectorAll("[data-reveal]"));
  if (targets.length === 0) {
    watchReducedMotion();
    return;
  }

  // Normally Base.astro's inline pre-paint script has already set this, which
  // is what avoids a fade-out flash on load. Adding it here is only a fallback
  // for the case where that script did not run.
  document.documentElement.classList.add(ENABLED_CLASS);
  assignDelays(document);

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target);
        observer?.unobserve(entry.target); // reveal once, then stop watching
      }
    },
    // A small negative bottom margin means an element commits to revealing
    // just after it genuinely enters view, not while still clipped.
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 },
  );

  for (const el of targets) observer.observe(el);
  watchReducedMotion();
}

function watchReducedMotion(): void {
  unsubscribeReducedMotion?.();
  unsubscribeReducedMotion = onReducedMotionChange((reduced) => {
    if (reduced) {
      // Flip to the static composition immediately: stop hiding, and mark
      // everything revealed so nothing is left mid-transition.
      observer?.disconnect();
      observer = null;
      document.documentElement.classList.remove(ENABLED_CLASS);
      for (const el of Array.from(document.querySelectorAll("[data-reveal]"))) {
        el.classList.add(REVEALED_CLASS);
      }
    } else {
      initReveal();
    }
  });
}

export function teardownReveal(): void {
  observer?.disconnect();
  observer = null;
  unsubscribeReducedMotion?.();
  unsubscribeReducedMotion = null;
}
