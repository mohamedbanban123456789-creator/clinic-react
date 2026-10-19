"use client";

import { HashRouter } from "react-router-dom";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { SPRINGS } from "./motion";

/**
 * Client-only root: HashRouter needs `window`, so this component is always
 * mounted behind a `ssr: false` dynamic import (see src/app/page.tsx).
 *
 * MotionConfig:
 *  - reducedMotion="user"  → transforms auto-disabled under
 *    prefers-reduced-motion (opacity fades remain, layout is stable).
 *  - default transition    → the clinic's calm spring (damping 1.0,
 *    response 0.4). Screens may override per-animation, but only with
 *    tokens from src/clinic/motion — never ad-hoc springs.
 */
export default function ClinicRoot() {
  return (
    <MotionConfig reducedMotion="user" transition={SPRINGS.calm}>
      <HashRouter>
        <App />
      </HashRouter>
    </MotionConfig>
  );
}
