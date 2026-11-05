import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeTestDeps, type TestDeps } from "../helpers/deps.js";
import {
  authHeader,
  buildTestApp,
  seedAccount,
  seedCurrentConsents,
  seedLegalDocuments,
} from "../helpers/app.js";

const UID = "u-route-1";

async function setup(): Promise<{ deps: TestDeps; app: FastifyInstance }> {
  const deps = makeTestDeps();
  await seedLegalDocuments(deps);
  const app = buildTestApp(deps);
  return { deps, app };
}

describe("GET /healthz", () => {
  it("200 を返す（認証不要）", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
    expect(res.headers["x-request-id"]).toBeTruthy();
    await app.close();
  });
});

describe("GET /v1/public/legal-documents", () => {
  it("現行文書セットを返す", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "GET",
      url: "/v1/public/legal-documents",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.requiredConsents).toContain("terms_of_service");
    expect(body.documents.terms_of_service.version).toBe("2026-11-01");
    await app.close();
  });
});

describe("認証ガード", () => {
  it("Authorization 無しは 401", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/v1/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHENTICATED");
    await app.close();
  });

  it("不正トークンは 401", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { authorization: "Bearer garbage" },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("失効ユーザーは 401", async () => {
    const { deps, app } = await setup();
    deps.fakeAuth.revoked.add(UID);
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: authHeader(UID),
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it("App Check enforce 時にトークン無しは 401 APP_CHECK_FAILED", async () => {
    const deps = makeTestDeps({ appCheckMode: "enforce" });
    await seedLegalDocuments(deps);
    await seedAccount(deps, UID);
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: authHeader(UID),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("APP_CHECK_FAILED");

    const ok = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: { ...authHeader(UID), "x-firebase-appcheck": "valid-appcheck" },
    });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("pending_deletion は通常 API を遮断し /me と退会APIは通る", async () => {
    const deps = makeTestDeps();
    await seedLegalDocuments(deps);
    await seedAccount(deps, UID, { accountStatus: "pending_deletion" });
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/v1/me/profile",
      headers: authHeader(UID),
    });
    expect(res.statusCode).toBe(403);

    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: authHeader(UID),
    });
    expect(me.statusCode).toBe(200);
    await app.close();
  });
});

describe("GET /v1/me", () => {
  it("アカウント状態・同意状態・プロフィール完了度を返す", async () => {
    const deps = makeTestDeps();
    await seedLegalDocuments(deps);
    await seedAccount(deps, UID, { accountStatus: "pending_deletion" });
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: authHeader(UID),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.uid).toBe(UID);
    expect(body.accountStatus).toBe("pending_deletion");
    expect(body.requiredConsents.current).toBe(false);
    await app.close();
  });
});

describe("PATCH /v1/me/profile", () => {
  it("同意未完了（legal_pending）は 412 で保存しない", async () => {
    const deps = makeTestDeps();
    await seedLegalDocuments(deps);
    await seedAccount(deps, UID, {
      accountStatus: "onboarding_pending",
      onboardingState: "legal_pending",
    });
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: authHeader(UID),
      payload: { familyName: "田中" },
    });
    expect(res.statusCode).toBe(412);
    expect((await deps.db.doc(`patientProfiles/${UID}`).get()).exists).toBe(
      false,
    );
    await app.close();
  });

  it("現行同意済みなら保存され、必須項目充足で active になる", async () => {
    const deps = makeTestDeps();
    await seedLegalDocuments(deps);
    await seedAccount(deps, UID, {
      accountStatus: "onboarding_pending",
      onboardingState: "profile_pending",
    });
    await seedCurrentConsents(deps, UID);
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: authHeader(UID),
      payload: {
        familyName: "田中",
        givenName: "太郎",
        familyNameKana: "タナカ",
        givenNameKana: "タロウ",
        birthDate: "1990-05-15",
        phoneNumber: "09012345678",
        postalCode: "1234567",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().profileComplete).toBe(true);
    const account = await deps.db.doc(`accounts/${UID}`).get();
    expect(account.data()!.accountStatus).toBe("active");
    expect(account.data()!.onboardingState).toBe("completed");
    await app.close();
  });

  it("バリデーションエラーは 400 + fieldErrors", async () => {
    const deps = makeTestDeps();
    await seedLegalDocuments(deps);
    await seedAccount(deps, UID);
    await seedCurrentConsents(deps, UID);
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/me/profile",
      headers: authHeader(UID),
      payload: { birthDate: "2999-01-01" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.fieldErrors.length).toBeGreaterThan(0);
    await app.close();
  });
});

describe("POST /v1/auth/register", () => {
  const payload = {
    email: "route@example.com",
    password: "abcd1234",
    consents: {
      terms_of_service: { accepted: true, documentVersion: "2026-11-01" },
      privacy_policy_ack: { accepted: true, documentVersion: "2026-11-01" },
      health_data_collection: { accepted: true, documentVersion: "2026-11-01" },
    },
  };

  it("201 + 登録結果を返す", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      headers: { "idempotency-key": "reg-1" },
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().registrationStatus).toBe("created");
    await app.close();
  });

  it("Idempotency-Key 無しは 400", async () => {
    const { app } = await setup();
    const res = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_FAILED");
    await app.close();
  });

  it("レート制限超過は 429 + Retry-After", async () => {
    const { app } = await setup();
    let last = 0;
    for (let i = 0; i < 7; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        headers: { "idempotency-key": `reg-${i}` },
        payload: { ...payload, email: `u${i}@example.com` },
      });
      last = res.statusCode;
    }
    expect(last).toBe(429);
    await app.close();
  });
});

describe("POST /v1/onboarding/consents", () => {
  it("現行同意の記録で profile_pending に進む", async () => {
    const deps = makeTestDeps();
    await seedLegalDocuments(deps);
    const app = buildTestApp(deps);
    const res = await app.inject({
      method: "POST",
      url: "/v1/onboarding/consents",
      headers: { ...authHeader("new-user"), "idempotency-key": "oc-1" },
      payload: {
        consents: {
          terms_of_service: { accepted: true, documentVersion: "2026-11-01" },
          privacy_policy_ack: { accepted: true, documentVersion: "2026-11-01" },
          health_data_collection: {
            accepted: true,
            documentVersion: "2026-11-01",
          },
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().onboardingState).toBe("profile_pending");
    const consents = await deps.db
      .collection("legalConsents")
      .where("subjectUid", "==", "new-user")
      .get();
    expect(consents.size).toBe(3);
    await app.close();
  });
});
