/**
 * Public-gateway-safe API proxy: /clinic-api/* -> Express :4000/api/*.
 *
 * WHY: the space-z.ai public preview gateway reserves /api/* and /socket.io/*
 * for platform routing and answers 502 before the request ever reaches this
 * sandbox. The clinic frontend therefore talks to the backend through the
 * /clinic-api/* prefix (see src/clinic/api/client.ts BASE), which the gateway
 * forwards like any normal page path.
 *
 * This is a pure transport-layer proxy (frontend deployment concern):
 * - forwards method, query, headers and streaming body to Express unchanged
 * - rewrites the refresh-cookie Path (/api/v1/auth -> /clinic-api/v1/auth) so
 *   the browser stores and replays the HttpOnly cookie on the new prefix
 * - strips hop-by-hop headers + content-encoding/length (undici decompresses)
 * - NO backend logic, routes, contracts or schema are touched (RULE #1)
 */

import { type NextRequest } from "next/server";

const BACKEND = process.env.CLINIC_BACKEND_URL ?? "http://127.0.0.1:4000";

/** Headers never forwarded across a proxy hop. */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "accept-encoding",
]);

const BACKEND_COOKIE_PATH = /([Pp]ath=)\/api\/v1\/auth/g;

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path?: string[] }> },
): Promise<Response> {
  const { path } = await ctx.params;
  const segments = (path ?? []).map((s) => encodeURIComponent(s)).join("/");
  const target = `${BACKEND}/api/${segments}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  const init: RequestInit = {
    method: req.method,
    headers,
    redirect: "manual",
  };
  if (hasBody && req.body) {
    init.body = req.body;
    // Node undici streaming request body — typed via cast because TS omits
    // the (standard) duplex option from RequestInit.
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch {
    return Response.json(
      {
        error: {
          code: "NETWORK",
          message: "تعذر الوصول إلى الخادم، تحقق من الاتصال",
          details: [],
        },
      },
      { status: 502 },
    );
  }

  const resHeaders = new Headers();
  upstream.headers.forEach((value, key) => {
    const lk = key.toLowerCase();
    if (lk === "set-cookie") return; // handled below (multi-value)
    if (HOP_BY_HOP.has(lk)) return;
    // undici already decoded the body — never advertise its encoding/length.
    if (lk === "content-encoding" || lk === "content-length") return;
    resHeaders.set(key, value);
  });

  const setCookies =
    typeof upstream.headers.getSetCookie === "function"
      ? upstream.headers.getSetCookie()
      : [];
  for (const cookie of setCookies) {
    resHeaders.append(
      "set-cookie",
      cookie.replace(BACKEND_COOKIE_PATH, "$1/clinic-api/v1/auth"),
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: resHeaders,
  });
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
