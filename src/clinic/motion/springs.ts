/**
 * سكينة Motion System — Spring Design Tokens
 * ------------------------------------------------------------------
 * Apple "fluid interfaces" baseline, tuned for a mental-health clinic:
 * calm, critically damped, no bouncy/springy playfulness by default.
 *
 * framer-motion's duration+bounce API maps directly to the Apple model:
 *   - `bounce: 0`    → damping ratio 1.0 (critically damped, no overshoot)
 *   - `duration`     → response (settle time, seconds)
 *
 * Rules of engagement (see design contract with the owner):
 *   1. Default motion  → SPRINGS.calm      (damping 1.0, response 0.4)
 *   2. Sheets/drawers  → SPRINGS.sheet     (damping 1.0, response 0.3)
 *   3. Flick momentum  → SPRINGS.momentum  (subtle overshoot 0.15 ONLY
 *      when a user throw/flick precedes the settle — never on plain UI)
 *   4. Every animation must start from the live presentation value and
 *      stay interruptible (springs retarget; CSS transitions don't).
 */

import type { Transition } from "framer-motion";

export type SpringKind = "calm" | "sheet" | "momentum" | "spacious" | "micro";

/**
 * The five approved springs. Nothing outside this set may be invented
 * ad-hoc inside screens — consistency IS the calm feeling.
 */
export const SPRINGS = {
  /** Default move/reposition — graceful, no overshoot. */
  calm: { type: "spring", bounce: 0, duration: 0.4 },
  /** Drawers, sheets, modals — quicker settle, still zero bounce. */
  sheet: { type: "spring", bounce: 0, duration: 0.3 },
  /** Momentum settle after a flick — the ONLY place bounce is allowed. */
  momentum: { type: "spring", bounce: 0.15, duration: 0.35 },
  /** Large surfaces / hero repositioning — unhurried. */
  spacious: { type: "spring", bounce: 0, duration: 0.5 },
  /** Micro feedback (dots, chips, toggles) — near-instant. */
  micro: { type: "spring", bounce: 0, duration: 0.22 },
} satisfies Record<SpringKind, Transition>;

/**
 * Non-spring tweens for the few places a tween is *more* correct
 * than a spring (fast dismissals, press echoes).
 */
export const TWEENS = {
  /** Pointer-down press feedback — 100ms ease-out, matches .pressable CSS. */
  press: { duration: 0.1, ease: "easeOut" },
  /** Exit/dismiss — quick and quiet, never springy. */
  exit: { duration: 0.2, ease: [0.32, 0.72, 0, 1] },
  /** Pure opacity fades. */
  fade: { duration: 0.25, ease: "easeOut" },
} satisfies Record<string, Transition>;

/**
 * Momentum projection (Apple UIScrollView math):
 * where would the content coast to if we let friction decay it?
 */
export function project(
  initialVelocityPxPerSec: number,
  decelerationRate = 0.998
): number {
  return (
    (initialVelocityPxPerSec / 1000) * decelerationRate / (1 - decelerationRate)
  );
}

/**
 * Progressive resistance at boundaries — never a hard freeze.
 * Overshoot decays asymptotically, so the edge feels like soft matter.
 */
export function rubberband(
  overshoot: number,
  dimension: number,
  constant = 0.55
): number {
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}

/** Nearest snap point to a projected resting position. */
export function nearestSnap(position: number, snapPoints: number[]): number {
  return snapPoints.reduce((best, p) =>
    Math.abs(p - position) < Math.abs(best - position) ? p : best
  );
}
