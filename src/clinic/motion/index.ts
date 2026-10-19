/**
 * سكينة Motion System — public API
 * ------------------------------------------------------------------
 * The single import point for all motion in the clinic app:
 *
 *   import { SPRINGS, sheetRight, useEdgeDrawer, pressable } from "@/clinic/motion";
 *
 * Contract (Apple fluid interfaces, mental-health edition):
 *   1. Response      — feedback on pointer-down, zero artificial delay.
 *   2. Tracking      — 1:1 with the pointer, grab-offset respected.
 *   3. Interruption  — animate from live values; springs retarget;
 *                      no CSS keyframes for gesture-driven UI.
 *   4. Behavior      — damping 1.0 default (bounce 0); bounce 0.15 only
 *                      after a real flick.
 *   5. Handoff       — release velocity seeds the settle spring.
 *   6. Projection    — flick targets come from momentum math, not the
 *                      release point.
 *   7. Spatial       — RTL mirrored: in from right, out to right.
 *   8. Boundaries    — rubber-band, never a hard freeze.
 *   9. Materials     — translucent chrome; never stacked glass-on-glass.
 *  10. Typography    — Arabic: letter-spacing 0, leading 1.6–1.8,
 *                      IBM Plex Sans Arabic 300–700 (already set).
 *  11. Accessibility — MotionConfig reducedMotion="user" at the root;
 *                      CSS fallbacks for reduced-motion & transparency.
 */

export * from "./springs";
export * from "./variants";
export * from "./gestures";
