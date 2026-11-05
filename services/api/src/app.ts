import Fastify, { type FastifyInstance } from "fastify";
import type { Deps } from "./deps.js";
import { resolveRequestId } from "./lib/requestId.js";
import { ApiError, sendError } from "./lib/errors.js";
import { enforceAccess } from "./auth/gates.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerMeRoutes } from "./routes/me.js";
import { registerInternalJobRoutes } from "./routes/internalJobs.js";

/**
 * Fastify アプリケーションの組み立て。
 * 認証・App Check・状態/同意・認可・レート制御は enforceAccess に集約し、
 * ルート側は config.access で利用階層を宣言する。
 */
export function buildApp(deps: Deps): FastifyInstance {
  const app = Fastify({
    loggerInstance: deps.logger.child({ component: "http" }),
    // X-Request-Id を genReqId で解決し req.id と一体化する。
    // ログ（requestId=request.id）と応答ヘッダ・エラー本文が同一IDで相関できる。
    genReqId: (req) => {
      const raw = req.headers["x-request-id"];
      const header = Array.isArray(raw) ? raw[0] : raw;
      return resolveRequestId(header);
    },
  });

  // requestContext へ Fastify の req.id をそのまま格納し応答ヘッダへ反映
  app.addHook("onRequest", async (req, reply) => {
    req.requestContext = { requestId: req.id };
    void reply.header("x-request-id", req.id);
  });

  // ルートごとのアクセス階層を一括適用（認証→App Check→状態・同意→認可→レート）
  app.addHook("preHandler", async (req) => enforceAccess(deps, req));

  app.setErrorHandler((err, req, reply) => sendError(req, reply, err));
  app.setNotFoundHandler((req, reply) => {
    void sendError(req, reply, ApiError.notFound());
  });

  registerHealthRoutes(app, deps);
  registerPublicRoutes(app, deps);
  registerAuthRoutes(app, deps);
  registerMeRoutes(app, deps);
  registerInternalJobRoutes(app, deps);

  return app;
}
