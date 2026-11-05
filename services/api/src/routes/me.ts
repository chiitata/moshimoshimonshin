import type { FastifyInstance } from "fastify";
import type { Deps } from "../deps.js";
import { requireIdempotencyKey } from "../lib/idempotency.js";
import { RateRules } from "../lib/rateLimit.js";
import { getMe } from "../services/me.js";
import { getMyProfile, patchMyProfile } from "../services/profile.js";
import { recordOnboardingConsents } from "../services/onboarding.js";
import { latestGrantedByType, listConsents } from "../repos/accounts.js";

/**
 * 患者向けアカウント・同意 API（API-001〜005）。
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
}

function toIso(value: unknown): string | undefined {
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  return undefined;
}
