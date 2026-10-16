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
  // Next.js origin so the SPA's relative /api/v1 + /socket.io calls,
  // refresh cookies, and realtime traffic stay same-origin.
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${CLINIC_BACKEND}/api/:path*` },
      // Bare "/socket.io" (after Next's trailing-slash 308) needs an exact
      // match so the engine.io handshake isn't dropped with a 404.
      { source: "/socket.io", destination: `${CLINIC_BACKEND}/socket.io/` },
      {
        source: "/socket.io/:path*",
        destination: `${CLINIC_BACKEND}/socket.io/:path*`,
      },
    ];
  },
};

export default nextConfig;
