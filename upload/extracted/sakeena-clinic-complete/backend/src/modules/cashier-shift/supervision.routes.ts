/**
 * BE-305 / BE-306 legacy supervision router shim.
 *
 * Canonical implementation moved to `src/modules/supervision/` for BE-702
 * (ticket scope: `src/modules/supervision/`). This module re-exports the
 * canonical router so any legacy import path keeps working with a single
 * source of truth. New code imports from `../supervision/supervision.routes.js`.
 */
export { supervisionRouter } from '../supervision/supervision.routes.js';
