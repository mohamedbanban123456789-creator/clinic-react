import type { NextConfig } from "next";

const CLINIC_BACKEND = process.env.CLINIC_BACKEND_URL ?? "http://127.0.0.1:4000";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Hide the floating Next.js dev-tools indicator — it overlapped the
  // clinic's floating chat button and blocked clicks in the preview.
  devIndicators: false,
  // Proxy the clinic backend (Express + Socket.io on :4000) through the
  // Next.js origin so the SPA's relative /clinic-api/v1 + /clinic-socket.io
  // calls, refresh cookies, and realtime traffic stay same-origin.
  //
  // The SPA uses the /clinic-api + /clinic-socket.io prefixes (NOT /api +
  // /socket.io) because the public preview gateway reserves those two
  // platform paths and answers 502 before requests reach this sandbox.
  // /clinic-api/* is handled by the route handler at
  // src/app/clinic-api/[...path]/route.ts (it re-scopes the refresh
  // cookie); only the engine.io traffic is rewritten here.
  async rewrites() {
    return [
      // Bare "/clinic-socket.io" (after Next's trailing-slash 308) needs an
      // exact match so the engine.io handshake isn't dropped with a 404.
      { source: "/clinic-socket.io", destination: `${CLINIC_BACKEND}/socket.io/` },
      {
        source: "/clinic-socket.io/:path*",
        destination: `${CLINIC_BACKEND}/socket.io/:path*`,
      },
      // Legacy /api + /socket.io rewrites kept for direct (non-gateway)
      // local access and any external consumer already pointing at them.
      { source: "/api/:path*", destination: `${CLINIC_BACKEND}/api/:path*` },
      { source: "/socket.io", destination: `${CLINIC_BACKEND}/socket.io/` },
      {
        source: "/socket.io/:path*",
        destination: `${CLINIC_BACKEND}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
