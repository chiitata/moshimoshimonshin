import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeTestDeps, type TestDeps } from "../helpers/deps.js";
import {
  authHeader,
  buildTestApp,
  seedAccount,
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
