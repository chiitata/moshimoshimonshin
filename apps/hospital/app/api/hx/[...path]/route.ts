import type { NextRequest } from "next/server";
import {
  assertPortalClient,
  portalJson,
  readSession,
  sessionApiFetch,
} from "../../../../lib/session";

type Params = { params: Promise<{ path?: string[] }> };

/**
 * /api/hx/* — 職員画面から実APIへのBFFプロキシ。
 * ブラウザは Cookie のみで呼び出し、IDトークンは JS から隔離される。
 * 認可は引き続きAPI側（facilityMemberships 正本）が担う。
 */
async function proxy(req: NextRequest, params: Params["params"], method: string) {
  const forbidden = assertPortalClient(req);
  if (forbidden) return forbidden;

  const session = await readSession();
  if (!session) return portalJson({ error: "unauthenticated" }, { status: 401 });

  const { path = [] } = await params;
  if (path.length === 0 || path.some((seg) => !seg || seg === ".." || seg.includes("/"))) {
    return portalJson({ error: "bad_request" }, { status: 400 });
  }
  const target = `/v1/${path.map(encodeURIComponent).join("/")}${req.nextUrl.search}`;

  let body: unknown;
  if (method !== "GET" && method !== "DELETE") {
    const text = await req.text();
    if (text !== "") {
      try {
        body = JSON.parse(text);
      } catch {
        return portalJson({ error: "bad_request" }, { status: 400 });
      }
    }
  }
  const upstream = await sessionApiFetch(session, target, {
    method,
    ...(body !== undefined ? { body } : {}),
  }).catch(() => null);
  if (!upstream) return portalJson({ error: "service_unavailable" }, { status: 503 });

  const contentType = upstream.headers.get("content-type") ?? "";
  const text = await upstream.text();
  if (!contentType.includes("application/json") || text === "") {
    return portalJson({ error: "upstream_error" }, { status: 502 });
  }
  try {
    return portalJson(JSON.parse(text), { status: upstream.status });
  } catch {
    return portalJson({ error: "upstream_error" }, { status: 502 });
  }
}

export function GET(req: NextRequest, ctx: Params) {
  return proxy(req, ctx.params, "GET");
}
export function POST(req: NextRequest, ctx: Params) {
  return proxy(req, ctx.params, "POST");
}
export function PATCH(req: NextRequest, ctx: Params) {
  return proxy(req, ctx.params, "PATCH");
}
export function DELETE(req: NextRequest, ctx: Params) {
  return proxy(req, ctx.params, "DELETE");
}
