import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.js";
import { getMe } from "../services/me.js";

/**
 * 患者向けアカウント API（API-001）。
 * uid は検証済みトークンから解決し、URLにユーザーIDを置かない（03 §4.1）。
 */
export function registerMeRoutes(app: FastifyInstance, deps: Deps): void {
  // API-001
  app.get(
    "/v1/me",
    {
      config: {
        access: {
          tier: "authenticated",
          allowPendingDeletion: true,
          allowSuspended: true,
        },
      },
    },
    async (req) => getMe(deps, req),
  );
}
