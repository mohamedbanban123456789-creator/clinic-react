"use client";

import dynamic from "next/dynamic";

/**
 * Clinic SPA mount — HashRouter keeps every client-side route under the single
 * Next.js `/` route (no 404s on refresh, no conflict with the Next router).
 * The app bundle is fully client-only (ssr: false) because the SPA talks to
 * the backend via relative /api/v1 + /socket.io URLs and needs window.
 */
const ClinicRoot = dynamic(() => import("@/clinic/ClinicRoot"), {
  ssr: false,
  loading: () => (
    <div className="fullscreen-message" dir="rtl">
      <p>جارٍ تحميل نظام العيادة…</p>
    </div>
  ),
});

export default function Page() {
  return <ClinicRoot />;
}
