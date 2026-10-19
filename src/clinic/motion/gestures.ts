"use client";

/**
 * سكينة Motion System — Gesture Physics
 * ------------------------------------------------------------------
 * Direct manipulation primitives:
 *   - 1:1 tracking with grab-offset respect (never snap to center)
 *   - short velocity history for natural release velocity
 *   - momentum projection + snap targeting on release
 *   - interruptible springs seeded with the release velocity
 *   - rubber-band resistance at boundaries (via dragConstraints elastic)
 * All hooks are no-op-safe under `prefers-reduced-motion`.
 */

import { useEffect, useRef } from "react";
import {
  animate,
  useDragControls,
  useMotionValue,
  useReducedMotion,
  type MotionValue,
  type PanInfo,
} from "framer-motion";
import { SPRINGS, project, type SpringKind } from "./springs";

/* ------------------------------------------------------------------ */
/* Velocity tracking — last few pointermove samples, windowed          */
/* ------------------------------------------------------------------ */

export interface Velocity2D {
  x: number;
  y: number;
}

export interface VelocityTracker {
  add(x: number, y: number, t?: number): void;
  velocity(): Velocity2D;
  reset(): void;
}

/**
 * Keeps a short history of pointer samples and estimates release
 * velocity (px/s) from the samples inside `windowMs`. Use with plain
 * Pointer Events + setPointerCapture when framer-motion `drag` is not
 * a fit (custom surfaces, sliders, scrubbers).
 */
export function createVelocityTracker(
  windowMs = 100,
  maxSamples = 6
): VelocityTracker {
  const samples: Array<{ t: number; x: number; y: number }> = [];
  return {
    add(x, y, t = performance.now()) {
      samples.push({ t, x, y });
      if (samples.length > maxSamples) samples.shift();
    },
    velocity() {
      if (samples.length < 2) return { x: 0, y: 0 };
      const last = samples[samples.length - 1];
      let first = last;
      for (let i = samples.length - 2; i >= 0; i--) {
        if (last.t - samples[i].t <= windowMs) first = samples[i];
        else break;
      }
      const dt = (last.t - first.t) / 1000;
      if (dt <= 0) return { x: 0, y: 0 };
      return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
    },
    reset() {
      samples.length = 0;
    },
  };
}

/** Attach 1:1 drag with velocity handoff for a single axis. */
export function attachPointerDrag(
  el: HTMLElement,
  opts: {
    axis: "x" | "y";
    /** Called on every move with the live, grab-offset-respecting delta. */
    onMove(delta: number): void;
    /** Called on release with the projected resting point + raw velocity. */
    onRelease(projected: number, velocity: number): void;
    /** Progressive resistance beyond the given bounds. */
    bounds?: [min: number, max: number];
    rubberbandDimension?: number;
  }
): () => void {
  const axis = opts.axis;
  const tracker = createVelocityTracker();
  let pointerId = -1;
  let start = 0;
  let accumulated = 0;

  const onPointerDown = (e: PointerEvent) => {
    if (pointerId !== -1) return;
    pointerId = e.pointerId;
    el.setPointerCapture(pointerId);
    const rect = el.getBoundingClientRect();
    // Respect the grab offset: anchor to where the element was grabbed.
    start = axis === "x" ? e.clientX - rect.left : e.clientY - rect.top;
    tracker.reset();
    tracker.add(e.clientX, e.clientY);
    accumulated = 0;
    e.preventDefault();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    tracker.add(e.clientX, e.clientY);
    let delta = (axis === "x" ? e.clientX : e.clientY) - start;
    if (opts.bounds) {
      const [min, max] = opts.bounds;
      if (delta < min) {
        delta = min - rubberbandDistance(min - delta, opts.rubberbandDimension ?? 300);
      } else if (delta > max) {
        delta = max + rubberbandDistance(delta - max, opts.rubberbandDimension ?? 300);
      }
    }
    accumulated = delta;
    opts.onMove(delta);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    pointerId = -1;
    const v = tracker.velocity();
    const velocity = axis === "x" ? v.x : v.y;
    opts.onRelease(accumulated + project(velocity), velocity);
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerUp);
  return () => {
    el.removeEventListener("pointerdown", onPointerDown);
    el.removeEventListener("pointermove", onPointerMove);
    el.removeEventListener("pointerup", onPointerUp);
    el.removeEventListener("pointercancel", onPointerUp);
  };
}

function rubberbandDistance(overshoot: number, dimension: number): number {
  const constant = 0.55;
  return (
    (overshoot * dimension * constant) /
    (dimension + constant * Math.abs(overshoot))
  );
}

/* ------------------------------------------------------------------ */
/* Hooks                                                               */
/* ------------------------------------------------------------------ */

/**
 * Returns the approved spring, or an instant transition when the user
 * prefers reduced motion. Use for imperative `animate()` calls.
 */
export function useCalmTransition(kind: SpringKind = "calm") {
  const reduced = useReducedMotion();
  return reduced ? { duration: 0 } : SPRINGS[kind];
}

/* ------------------------------------------------------------------ */
/* Edge drawer — RTL-native sheet with flick physics                  */
/* ------------------------------------------------------------------ */

export interface EdgeDrawerConfig {
  open: boolean;
  /** Width of the drawer in px (snap target). */
  size: number;
  /**
   * Physical edge the drawer hangs from. RTL clinic default: "right".
   * In from the right, dismiss to the right — symmetric path.
   */
  side?: "left" | "right";
  /** Controlled mode: parent owns open state (recommended). */
  onOpenChange?: (open: boolean) => void;
  /** Fraction of size past which a release counts as "open". */
  openThreshold?: number;
}

export interface EdgeDrawerResult {
  x: MotionValue<number>;
  /** Spread onto the <motion.div> sheet. */
  motionProps: {
    drag: "x";
    dragConstraints: { left: number; right: number };
    dragElastic: number;
    dragListener: false;
    dragControls: ReturnType<typeof useDragControls>;
    onDragEnd: (e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => void;
    style: { x: MotionValue<number> };
  };
  /** Spread onto the drag handle (grabber bar / header). */
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
    style: { touchAction: "none" };
  };
}

/**
 * An interruptible edge drawer with:
 *   - 1:1 finger tracking (framer `drag`, rubber-band via dragElastic)
 *   - momentum projection on release (flick to open/close)
 *   - spring settle seeded with release velocity
 *   - full reduced-motion bailout
 *
 * Drag is initiated ONLY from the handle, so inner scrollable content
 * never fights the sheet. Tap the scrim via your own overlay.
 */
export function useEdgeDrawer(config: EdgeDrawerConfig): EdgeDrawerResult {
  const { open, onOpenChange, size, side = "right", openThreshold = 0.5 } = config;
  const closedX = side === "right" ? size : -size;
  const reduced = useReducedMotion();
  const x = useMotionValue(open ? closedX : 0);
  const dragControls = useDragControls();
  const releaseVelocity = useRef(0);
  const dragging = useRef(false);

  useEffect(() => {
    if (dragging.current) return;
    const target = open ? 0 : closedX;
    if (reduced) {
      x.set(target);
      return;
    }
    animate(x, target, {
      ...SPRINGS.sheet,
      velocity: releaseVelocity.current,
    });
  }, [open, closedX, reduced, x]);

  const onDragEnd = (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    dragging.current = false;
    releaseVelocity.current = info.velocity.x;
    // Project where a flick would coast to, then snap to the nearest edge.
    const projected = x.get() + project(info.velocity.x);
    const shouldOpen =
      closedX > 0 ? projected < closedX * openThreshold : projected > closedX * openThreshold;
    if (shouldOpen === open) {
      // Same state — settle back from the live value with the release velocity.
      animate(x, open ? 0 : closedX, {
        ...SPRINGS.momentum,
        velocity: info.velocity.x,
      });
    } else if (onOpenChange) {
      // Parent retargets; the effect above animates with the seeded velocity.
      onOpenChange(shouldOpen);
    } else {
      animate(x, shouldOpen ? 0 : closedX, {
        ...SPRINGS.momentum,
        velocity: info.velocity.x,
      });
    }
  };

  const handleProps = {
    onPointerDown: (e: React.PointerEvent) => {
      dragging.current = true;
      dragControls.start(e);
    },
    style: { touchAction: "none" } as const,
  };

  return {
    x,
    motionProps: {
      drag: "x",
      dragConstraints: { left: Math.min(0, closedX), right: Math.max(0, closedX) },
      dragElastic: 0.18,
      dragListener: false,
      dragControls,
      onDragEnd,
      style: { x },
    },
    handleProps,
  };
}
