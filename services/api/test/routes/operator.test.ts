import { describe, expect, it } from "vitest";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { makeTestDeps, type TestDeps } from "../helpers/deps.js";
import { authHeader, buildTestApp } from "../helpers/app.js";
import type { AuditEventDoc, FacilityDoc } from "../../src/domain/firestoreDocs.js";

const OP = "op-admin-1";
const FAC = "fac-op-1";

async function setup(opts: { operatorRole?: string } = {}) {
  const deps = makeTestDeps();
  const app = buildTestApp(deps);
  await app.ready();
  await deps.db.doc("facilityMemberships/op").set({
    userUid: OP,
    facilityId: "platform",
    role: opts.operatorRole ?? "platform_security_admin",
    status: "active",
  });
  return { app, deps };
}

async function seedFacility(
  deps: TestDeps,
  opts: {
    facilityId?: string;
    verificationStatus?: string;
    receivingEnabled?: boolean;
  } = {},
): Promise<string> {
  const id = opts.facilityId ?? FAC;
  const ts = FieldValue.serverTimestamp();
  await deps.db.doc(`facilities/${id}`).set({
    facilityId: id,
    legalName: "運営テスト病院",
    displayName: "運営テスト病院",
    verificationStatus: opts.verificationStatus ?? "pending",
    receivingEnabled: opts.receivingEnabled ?? false,
    serviceAgreementVersion: "v1",
    createdAt: ts,
    updatedAt: ts,
  });
  return id;
}

const VALID_CHECKS = {
  existence: true,
  applicant: true,
  receiverContact: true,
  location: true,
};

async function auditActions(deps: TestDeps, action: string) {
  const snap = await deps.db.collection("auditEvents").get();
  return snap.docs
    .map((d) => d.data() as AuditEventDoc)
    .filter((e) => e.action === action);
}

describe("POST /v1/operator/facilities/:facilityId/verify", () => {
  const url = `/v1/operator/facilities/${FAC}/verify`;

  it("未認証401・非運営403・存在しない施設404", async () => {
    const { app } = await setup();
    const body = {
      checks: VALID_CHECKS,
      verificationRecordId: "rec-1",
    };
    expect(
      (await app.inject({ method: "POST", url, payload: body })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: authHeader("not-operator"),
          payload: body,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: authHeader(OP),
          payload: body,
        })
      ).statusCode,
    ).toBe(404);
    await app.close();
  });

  it("検証項目が1つでも false なら400、recordId必須", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps);
    const bad = await app.inject({
      method: "POST",
      url,
      headers: authHeader(OP),
      payload: {
        checks: { ...VALID_CHECKS, location: false },
        verificationRecordId: "rec-1",
      },
    });
    expect(bad.statusCode).toBe(400);
    const noRecord = await app.inject({
      method: "POST",
      url,
      headers: authHeader(OP),
      payload: { checks: VALID_CHECKS },
    });
    expect(noRecord.statusCode).toBe(400);
    // 失敗しても verified にはなっていない
    const fac = (await deps.db.doc(`facilities/${FAC}`).get())
      .data() as FacilityDoc;
    expect(fac.verificationStatus).toBe("pending");
    await app.close();
  });

  it("pending → verified: 証跡doc・verifiedAt・recordId・監査を記録する", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps);

    const res = await app.inject({
      method: "POST",
      url,
      headers: authHeader(OP),
      payload: {
        checks: VALID_CHECKS,
        verificationRecordId: "medical-license-123",
        note: "登記簿謄本で確認",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().verificationStatus).toBe("verified");

    const fac = (await deps.db.doc(`facilities/${FAC}`).get())
      .data() as FacilityDoc;
    expect(fac.verificationStatus).toBe("verified");
    expect(fac.verifiedAt).toBeTruthy();
    expect(fac.verificationRecordId).toBe("medical-license-123");

    // FR-H04 検証証跡
    const recs = await deps.db.collection("facilityVerificationRecords").get();
    expect(recs.size).toBe(1);
    const rec = recs.docs[0]!.data() as Record<string, unknown>;
    expect(rec["facilityId"]).toBe(FAC);
    expect(rec["verifierUid"]).toBe(OP);
    expect(rec["checks"]).toEqual(VALID_CHECKS);
    expect(rec["verificationRecordId"]).toBe("medical-license-123");
    expect(rec["note"]).toBe("登記簿謄本で確認");

    const events = await auditActions(deps, "FACILITY_VERIFIED");
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("platform");
    expect(events[0]!.details).toEqual({
      from: "pending",
      recordId: "medical-license-123",
    });
    // 監査に生の施設ID/運営UIDを含めない
    expect(events[0]!.actorUidHash).not.toBe(OP);
    expect(events[0]!.resourceIdHash).not.toBe(FAC);
    await app.close();
  });

  it("既承認は409、suspended/rejectedからは再承認できる", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps, { verificationStatus: "suspended" });
    const body = { checks: VALID_CHECKS, verificationRecordId: "rec-2" };
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: authHeader(OP),
          payload: body,
        })
      ).statusCode,
    ).toBe(200);
    // 2回目（verified）は409
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: authHeader(OP),
          payload: body,
        })
      ).statusCode,
    ).toBe(409);
    // facilityId の文字種違反（doc パス分断）は400
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/operator/facilities/bad%20id/verify",
          headers: authHeader(OP),
          payload: body,
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });

  it("再認証が古い場合は403 REAUTH_REQUIRED", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps);
    deps.fakeAuth.authTimeByToken.set(`token-${OP}`, 1);
    const res = await app.inject({
      method: "POST",
      url,
      headers: authHeader(OP),
      payload: { checks: VALID_CHECKS, verificationRecordId: "r" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("REAUTH_REQUIRED");
    await app.close();
  });
});

describe("POST /v1/operator/facilities/:facilityId/disable", () => {
  const url = `/v1/operator/facilities/${FAC}/disable`;

  it("受付を停止し理由と時刻を記録、監査を発行する", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps, {
      verificationStatus: "verified",
      receivingEnabled: true,
    });

    const res = await app.inject({
      method: "POST",
      url,
      headers: authHeader(OP),
      payload: { reason: "緊急: 不正申請の疑い" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().receivingEnabled).toBe(false);

    const fac = (await deps.db.doc(`facilities/${FAC}`).get())
      .data() as FacilityDoc;
    expect(fac.receivingEnabled).toBe(false);
    expect(fac.receivingDisabledReason).toBe("緊急: 不正申請の疑い");
    expect(fac.receivingDisabledAt).toBeTruthy();
    // 停止は審査状態を変更しない（verified のまま）
    expect(fac.verificationStatus).toBe("verified");

    const events = await auditActions(deps, "FACILITY_RECEIVING_DISABLED");
    expect(events).toHaveLength(1);
    expect(events[0]!.actorType).toBe("platform");
    await app.close();
  });

  it("既停止の再呼出は冪等に成功し監査を重複発行しない", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps, {
      verificationStatus: "verified",
      receivingEnabled: false,
    });
    const res = await app.inject({
      method: "POST",
      url,
      headers: authHeader(OP),
      payload: { reason: "再送" },
    });
    expect(res.statusCode).toBe(200);
    expect(await auditActions(deps, "FACILITY_RECEIVING_DISABLED")).toHaveLength(
      0,
    );
    // 理由が既存値を上書きしない
    const fac = (await deps.db.doc(`facilities/${FAC}`).get())
      .data() as FacilityDoc;
    expect(fac.receivingDisabledReason).toBeUndefined();
    await app.close();
  });

  it("非運営403・404・reason必須400", async () => {
    const { app, deps } = await setup();
    await seedFacility(deps, {
      verificationStatus: "verified",
      receivingEnabled: true,
    });
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: authHeader("not-operator"),
          payload: { reason: "x" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/operator/facilities/fac-missing/disable",
          headers: authHeader(OP),
          payload: { reason: "x" },
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url,
          headers: authHeader(OP),
          payload: {},
        })
      ).statusCode,
    ).toBe(400);
    await app.close();
  });
});

describe("GET /v1/operator/job-failures", () => {
  async function seedFailedJobs(deps: TestDeps) {
    // OCR: failed ×3, succeeded ×1
    for (let i = 1; i <= 3; i++) {
      await deps.db.doc(`ocrJobs/job-ocr-${i}`).set({
        uploadId: `upload-${i}`,
        patientUid: "u-patient-secret",
        status: "failed",
        engine: "dummy",
        attempt: i,
        errorCode: "image_unclear",
        candidates: [],
        dispatchState: "enqueued",
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: Timestamp.fromMillis(1000 + i),
      });
    }
    await deps.db.doc("ocrJobs/job-ocr-ok").set({
      uploadId: "upload-ok",
      patientUid: "u-patient-secret",
      status: "succeeded",
      engine: "dummy",
      attempt: 1,
      errorCode: null,
      candidates: [],
      dispatchState: "enqueued",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: Timestamp.fromMillis(9999),
    });
    // deletion: failed ×1
    await deps.db.doc("deletionJobs/job-del-1").set({
      subjectUid: "u-subject-secret",
      requestedAt: Timestamp.fromMillis(5000),
      executeAfter: Timestamp.fromMillis(6000),
      status: "failed",
      steps: {},
      attemptCount: 2,
      lastErrorCode: "storage_delete_failed",
      lastStartedAt: Timestamp.fromMillis(7000),
    });
  }

  it("type=ocr で失敗ジョブのみ返し、PII識別子を含めない", async () => {
    const { app, deps } = await setup();
    await seedFailedJobs(deps);
    const res = await app.inject({
      method: "GET",
      url: "/v1/operator/job-failures?type=ocr&limit=10",
      headers: authHeader(OP),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(3);
    for (const it of items) {
      expect(it["type"]).toBe("ocr");
      expect(it["failureCode"]).toBe("image_unclear");
      // FR-O04: 患者UID/件名UID/アップロードIDを含めない
      const json = JSON.stringify(it);
      expect(json).not.toContain("u-patient-secret");
      expect(json).not.toContain("u-subject-secret");
      expect(json).not.toContain("upload-");
    }
    // updatedAt 降順（job-ocr-3 が先頭）
    expect(items[0]!["jobId"]).toBe("job-ocr-3");

    const events = await auditActions(deps, "JOB_FAILURES_LISTED");
    expect(events).toHaveLength(1);
    expect(events[0]!.details).toEqual({ type: "ocr" });
    await app.close();
  });

  it("type=deletion・カーソルページング・権限/バリデーション", async () => {
    const { app, deps } = await setup();
    await seedFailedJobs(deps);
    const res = await app.inject({
      method: "GET",
      url: "/v1/operator/job-failures?type=deletion",
      headers: authHeader(OP),
    });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as Array<Record<string, unknown>>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "deletion",
      jobId: "job-del-1",
      failureCode: "storage_delete_failed",
      attempts: 2,
    });
    expect(JSON.stringify(items[0])).not.toContain("u-subject-secret");

    // ページング
    const p1 = await app.inject({
      method: "GET",
      url: "/v1/operator/job-failures?type=ocr&limit=2",
      headers: authHeader(OP),
    });
    const j1 = p1.json();
    expect(j1.items).toHaveLength(2);
    expect(j1.nextCursor).toBe("job-ocr-2");
    const p2 = await app.inject({
      method: "GET",
      url: `/v1/operator/job-failures?type=ocr&limit=2&cursor=${j1.nextCursor}`,
      headers: authHeader(OP),
    });
    expect(p2.json().items).toHaveLength(1);
    expect(p2.json().nextCursor).toBeNull();

    // 権限とバリデーション
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/operator/job-failures?type=ocr",
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/operator/job-failures?type=ocr",
          headers: authHeader("not-operator"),
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/operator/job-failures?type=bad",
          headers: authHeader(OP),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/operator/job-failures?type=ocr&cursor=bad/cursor",
          headers: authHeader(OP),
        })
      ).statusCode,
    ).toBe(400);
    // 存在しない・対象外カーソルは空ページ
    const empty = await app.inject({
      method: "GET",
      url: "/v1/operator/job-failures?type=ocr&cursor=job-ocr-ok",
      headers: authHeader(OP),
    });
    expect(empty.json().items).toEqual([]);
    await app.close();
  });
});
