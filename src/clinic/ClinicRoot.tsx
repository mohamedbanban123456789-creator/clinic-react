"use client";

import { HashRouter } from "react-router-dom";
import App from "./App";

/**
 * Client-only root: HashRouter needs `window`, so this component is always
 * mounted behind a `ssr: false` dynamic import (see src/app/page.tsx).
 */
export default function ClinicRoot() {
  return (
    <HashRouter>
      <App />
    </HashRouter>
  );
}
