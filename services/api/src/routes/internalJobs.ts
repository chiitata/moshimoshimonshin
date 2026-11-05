import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Deps } from "../deps.js";
import { ApiError, assertParsed } from "../lib/errors.js";
import { DeletionWorker } from "../workers/deletionJob.js";

/**
 * 内部ジョブエンドポイント（Cloud Scheduler / Cloud Tasks 想定）。
 * 本番は Tasks OIDC 等に置き換える（infra issue #31）。ローカルは
 * X-Internal-Job-Token 共有鍵またはエミュレータ緩和で動作する。
 */
export function registerInternalJobRoutes(
  app: FastifyInstance,
  deps: Deps,
): void {
  const worker = new DeletionWorker(deps);

  // 期限スキャン（Scheduler → 本エンドポイント）
  app.post(
    "/v1/internal/jobs/deletion-scan",
    { config: { access: { tier: "internal" } } },
    async () => worker.scanDueJobs(),
  );

  // 単一ジョブ実行（Tasks の invoke target 想定。冪等）
  app.post(
    "/v1/internal/jobs/deletion-jobs/:jobId/run",
    { config: { access: { tier: "internal" } } },
    async (req) => {
      const params = assertParsed(
        z.object({ jobId: z.string().min(1).max(200) }).safeParse(req.params),
      );
      const result = await worker.runJob(params.jobId);
      if (result.outcome === "not_found") {
        throw ApiError.notFound("削除ジョブが見つかりません。");
      }
      return result;
    },
  );
}
