/**
 * سكينة Motion System — RTL-Aware Variants
 * ------------------------------------------------------------------
 * Spatial consistency rule (mirrored for RTL):
 *   surfaces ENTER from the right and EXIT to the right — the symmetric
 *   path, never a crossed one. framer-motion `x` is PHYSICAL (unaffected
 *   by dir="rtl"), so every value here is written in physical pixels and
 *   already mirrors the Latin "left" convention.
 *
 * Typography-adjacent motion rule: content moves at most ~32px on entry.
 * Large travels feel aggressive — this is a calm clinic, not a carousel.
 */

import type { Variants } from "framer-motion";
import { SPRINGS, TWEENS } from "./springs";

/** Pure opacity — safest for dense text blocks (queue lists, tables). */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TWEENS.fade },
  exit: { opacity: 0, transition: { duration: 0.15, ease: "easeOut" } },
};

/** Gentle rise — default for cards, panels, list items. */
export const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: SPRINGS.calm },
  exit: { opacity: 0, y: -10, transition: TWEENS.exit },
};

/**
 * Edge origin — enters from the RIGHT (RTL start edge), exits back the
 * way it came. Use for side cards, toast-like notices, inline banners.
 */
export const fromEdge: Variants = {
  hidden: { opacity: 0, x: 32 },
  visible: { opacity: 1, x: 0, transition: SPRINGS.calm },
  exit: { opacity: 0, x: 32, transition: TWEENS.exit },
};

/**
 * Right-anchored sheet/drawer — the workhorse for RTL drawers, mobile
 * nav, filter sheets. Symmetric: in from right, dismiss to right.
 * Pair with `useEdgeDrawer` for flick physics.
 */
export const sheetRight: Variants = {
  hidden: { x: "100%" },
  visible: { x: 0, transition: SPRINGS.sheet },
  exit: { x: "100%", transition: SPRINGS.sheet },
};

/**
 * Centered modal — "material condensing": scale + fade together, slight
 * rise. Anchor the transform-origin to the triggering element where a
 * popover is used instead of a dialog.
 */
export const modalCenter: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 10 },
  visible: { opacity: 1, scale: 1, y: 0, transition: SPRINGS.sheet },
  exit: { opacity: 0, scale: 0.97, y: 6, transition: TWEENS.exit },
};

/** Backdrop companions — fade only, never scale (behind glass). */
export const backdropFade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: TWEENS.fade },
  exit: { opacity: 0, transition: { duration: 0.18, ease: "easeOut" } },
};

/** Staggered container — children use `rise` (or `fromEdge`). */
export const listStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
  /** Exits collapse newest-first — the list retracts, doesn't scatter. */
  exit: { transition: { staggerChildren: 0.03, staggerDirection: -1 } },
};

/** Smaller stagger for dense rows (queue, receipts, meds). */
export const denseStagger: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.028, delayChildren: 0.02 } },
  exit: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
};

/**
 * Press feedback bundle for motion buttons/tap targets:
 *   <motion.button {...pressable} ...> — responds on pointer-DOWN,
 *   100ms ease-out, exactly the .pressable CSS contract.
 */
export const pressable = {
  whileTap: { scale: 0.98 },
  transition: TWEENS.press,
} as const;

/**
 * Viewport reveal — cards settle in as they scroll into view.
 * `once: true` keeps it dignified; no re-animation on scroll-back.
 */
export const revealOnScroll = {
  initial: "hidden" as const,
  whileInView: "visible" as const,
  viewport: { once: true, margin: "-8% 0px" },
};
