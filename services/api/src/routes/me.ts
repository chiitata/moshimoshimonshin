import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.js";
import { requireFreshAuth } from "../auth/gates.js";
import { requireIdempotencyKey } from "../lib/idempotency.js";
import { emptyBodySchema } from "../domain/schemas.js";
import { assertParsed } from "../lib/errors.js";
import { RateRules } from "../lib/rateLimit.js";
import { getMe } from "../services/me.js";
import { getMyProfile, patchMyProfile } from "../services/profile.js";
import { recordOnboardingConsents } from "../services/onboarding.js";
import {
  cancelDeletion,
  getDeletionStatus,
  requestDeletion,
} from "../services/deletion.js";
import { latestGrantedByType, listConsents } from "../repos/accounts.js";

/**
 * 患者向けアカウント・同意・退会 API（API-001〜008）。
 * uid は検証済みトークンから解決し、URLにユーザーIDを置かない（03 §4.1）。
 */
export function registerMeRoutes(app: FastifyInstance, deps: Deps): void {
  const uidOf = (req: { requestContext: { auth?: { uid: string } } }) =>
    req.requestContext.auth!.uid;

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

  // API-003
  app.get(
    "/v1/me/profile",
    { config: { access: { tier: "authenticated" } } },
    async (req) => getMyProfile(deps, uidOf(req)),
  );

  // API-002
  app.patch(
    "/v1/me/profile",
    { config: { access: { tier: "consented" } } },
    async (req) => patchMyProfile(deps, uidOf(req), req.body),
  );

  // API-004
  app.post(
    "/v1/onboarding/consents",
    {
      config: {
        access: { tier: "authenticated", rateRule: RateRules.consents },
      },
    },
    async (req) => {
      const idempotencyKey = requireIdempotencyKey(req);
      const auth = req.requestContext.auth!;
      return recordOnboardingConsents(deps, {
        uid: auth.uid,
        providers: auth.providers,
        emailVerified: auth.emailVerified ?? false,
        body: req.body,
        idempotencyKey,
        requestId: req.requestContext.requestId,
      });
    },
  );

  // API-005
  app.get(
    "/v1/consents",
    { config: { access: { tier: "authenticated" } } },
    async (req) => {
      const consents = await listConsents(deps.db, uidOf(req));
      return {
        consents: consents.map(({ id, data }) => ({
          consentId: id,
          consentType: data.consentType,
          documentVersion: data.documentVersion,
          decision: data.decision,
          method: data.method,
          registrationSource: data.registrationSource,
          occurredAt: toIso(data.occurredAt),
          revokedAt: toIso(data.revokedAt) ?? null,
        })),
        currentByType: Object.fromEntries(
          [...latestGrantedByType(consents)].map(([type, doc]) => [
            type,
            doc.documentVersion,
          ]),
        ),
      };
    },
  );

  // API-006
  app.post(
    "/v1/me/deletion-request",
    {
      config: {
        access: {
          tier: "authenticated",
          allowPendingDeletion: true,
          rateRule: RateRules.deletionRequest,
        },
      },
    },
    async (req, reply) => {
      assertParsed(emptyBodySchema.safeParse(req.body ?? {}));
      requireFreshAuth(deps, req);
      const idempotencyKey = requireIdempotencyKey(req);
      const result = await requestDeletion(deps, {
        uid: uidOf(req),
        idempotencyKey,
        requestId: req.requestContext.requestId,
      });
      return reply.status(202).send(result);
    },
  );

  // API-007
  app.post(
    "/v1/me/deletion-request/cancel",
    {
      config: {
        access: {
          tier: "authenticated",
          allowPendingDeletion: true,
          rateRule: RateRules.deletionRequest,
        },
      },
    },
    async (req) => {
      assertParsed(emptyBodySchema.safeParse(req.body ?? {}));
      requireFreshAuth(deps, req);
      const idempotencyKey = requireIdempotencyKey(req);
      return cancelDeletion(deps, {
        uid: uidOf(req),
        idempotencyKey,
        requestId: req.requestContext.requestId,
      });
    },
  );

  // API-008
  app.get(
    "/v1/me/deletion-request",
    {
      config: {
        access: { tier: "authenticated", allowPendingDeletion: true },
      },
    },
    async (req) => getDeletionStatus(deps, uidOf(req)),
  );
}

function toIso(value: unknown): string | undefined {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return undefined;
}
