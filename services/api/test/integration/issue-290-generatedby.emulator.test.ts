import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  authHeader,
  buildTestApp,
  seedAccount,
  seedCurrentConsents,
  seedLegalDocuments,
} from "../helpers/app.js";
import {
  clearEmulatorFirestore,
  makeEmulatorDeps,
  type EmulatorDeps,
} from "../helpers/emulator.js";
import { makeTestConfig } from "../helpers/deps.js";
import { VertexAiLlmAdapter } from "../../src/engines/vertexLlm.js";

const PATIENT = "emu-issue290-patient";

/**
 * Issue #290 受入: AI生成とfallbackの識別（staging相当 = 実API +
 * Firestore/Authエミュレータ + 合成データのみ）。
 *
 * 実クラウドへは出ない。VertexAiLlmAdapter には合成の accessToken と
 * aiplatform host 限定の合成 fetch を注入し、アダプタ実装
 * （endpoint・requestSchema・応答解析・modelVersion）を実コードで通す。
 * 実Vertexへの到達性は本受入の対象外（資格情報・デプロイを要し別途確認）。
 *
 * 合成データのみ使用し、質問文・自由記述・トークンをログへ出力しない。
 */
describe("Issue #290: generatedBy 識別 / Firestore emulator", () => {
  let deps: EmulatorDeps;
  let app: FastifyInstance;
  let upstreamStatus: number;
  let upstreamCalls: number;
  let originalFetch: typeof fetch;

  const syntheticLlmQuestion = {
    questionText: "その症状はいつ頃から続いていますか？",
    topic: "onset",
    options: [
      { code: "TODAY", label: "今日から" },
      { code: "THIS_WEEK", label: "今週に入ってから" },
      { code: "LONGER", label: "それより前から" },
    ],
  };

  beforeEach(async () => {
    await clearEmulatorFirestore();
    deps = makeEmulatorDeps({ config: { aiIntakeEnabled: true } });
    await seedLegalDocuments(deps);
    await seedAccount(deps, PATIENT);
    await seedCurrentConsents(deps, PATIENT);

    upstreamStatus = 200;
    upstreamCalls = 0;
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("aiplatform.googleapis.com")) {
        return originalFetch(input, init);
      }
      upstreamCalls += 1;
      if (upstreamStatus !== 200) {
        return new Response("upstream error", { status: upstreamStatus });
      }
      const text = JSON.stringify({ questions: [syntheticLlmQuestion] });
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    // 本番配線と同じ Vertex アダプタ（認証は合成トークン、送信先は上記合成応答）。
    deps.llmAdapter = new VertexAiLlmAdapter(
      {
        model: "gemini-2.5-flash-lite",
        location: "asia-northeast1",
        projectId: "demo-mmr-dev",
        timeoutMs: 5_000,
      },
      async () => "synthetic-access-token",
    );
    app = buildTestApp(deps);
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
    await clearEmulatorFirestore();
  });

  async function createIntakeAndReachQuestioning(): Promise<{
    intakeId: string;
    revision: number;
  }> {
    const intake = await app.inject({
      method: "POST",
      url: "/v1/intakes",
      headers: { ...authHeader(PATIENT), "idempotency-key": `i290-${Date.now()}` },
      payload: { locale: "ja-JP" },
    });
    expect(intake.statusCode).toBe(201);
    const { intakeId } = intake.json() as { intakeId: string };
    const symptoms = await app.inject({
      method: "POST",
      url: `/v1/intakes/${intakeId}/symptoms`,
      headers: authHeader(PATIENT),
      payload: {
        initialSymptomText: "合成症状：けさから頭痛",
        bodyLocations: ["head"],
        expectedIntakeRevision: 1,
      },
    });
    expect(symptoms.statusCode).toBe(200);
    return { intakeId, revision: 2 };
  }

  function postNextQuestion(intakeId: string, revision: number) {
    return app.inject({
      method: "POST",
      url: `/v1/intakes/${intakeId}/next-question`,
      headers: authHeader(PATIENT),
      payload: { expectedIntakeRevision: revision },
    });
  }

  async function persistedGeneratedBy(
    intakeId: string,
  ): Promise<{ generatedBy: string; modelVersion: string | null }> {
    const detail = await app.inject({
      method: "GET",
      url: `/v1/intakes/${intakeId}`,
      headers: authHeader(PATIENT),
    });
    expect(detail.statusCode).toBe(200);
    const q = (detail.json() as { questions: Array<{ generatedBy: string; modelVersion: string | null }> })
      .questions.at(-1)!;
    return { generatedBy: q.generatedBy, modelVersion: q.modelVersion };
  }

  it("AI承認+合成上流成功 → API結果と永続化の両方で generatedBy=llm と判別できる", async () => {
    const { intakeId, revision } = await createIntakeAndReachQuestioning();
    const res = await postNextQuestion(intakeId, revision);
    expect(res.statusCode).toBe(200);
    const { question } = res.json() as {
      question: { generatedBy: string; modelVersion: string | null };
    };
    expect(question.generatedBy).toBe("llm");
    expect(question.modelVersion).toBe("gemini-2.5-flash-lite/asia-northeast1");
    expect(upstreamCalls).toBe(1);
    expect(await persistedGeneratedBy(intakeId)).toEqual({
      generatedBy: "llm",
      modelVersion: "gemini-2.5-flash-lite/asia-northeast1",
    });
  });

  it("上流障害（合成500応答） → generatedBy=fallback と判別でき llm と混同しない", async () => {
    const { intakeId, revision } = await createIntakeAndReachQuestioning();
    upstreamStatus = 500;
    const res = await postNextQuestion(intakeId, revision);
    expect(res.statusCode).toBe(200);
    const { question } = res.json() as {
      question: { generatedBy: string; modelVersion: string | null };
    };
    expect(question.generatedBy).toBe("fallback");
    expect(question.modelVersion).toBeNull();
    expect(upstreamCalls).toBe(1);
    expect(await persistedGeneratedBy(intakeId)).toEqual({
      generatedBy: "fallback",
      modelVersion: null,
    });
  });

  it("実行時停止スイッチで AI承認済み問診も generatedBy=fallback になる", async () => {
    const { intakeId, revision } = await createIntakeAndReachQuestioning();
    deps.config = makeTestConfig({ aiIntakeEnabled: false });
    const res = await postNextQuestion(intakeId, revision);
    expect(res.statusCode).toBe(200);
    const { question } = res.json() as {
      question: { generatedBy: string; modelVersion: string | null };
    };
    expect(question.generatedBy).toBe("fallback");
    expect(upstreamCalls).toBe(0);
    expect(await persistedGeneratedBy(intakeId)).toEqual({
      generatedBy: "fallback",
      modelVersion: null,
    });
  });

  it("AI未承認の問診は generatedBy=fixed_template で上流を呼ばない", async () => {
    deps.config = makeTestConfig({ aiIntakeEnabled: false });
    const { intakeId, revision } = await createIntakeAndReachQuestioning();
    const res = await postNextQuestion(intakeId, revision);
    expect(res.statusCode).toBe(200);
    const { question } = res.json() as {
      question: { generatedBy: string; modelVersion: string | null };
    };
    expect(question.generatedBy).toBe("fixed_template");
    expect(question.modelVersion).toBeNull();
    expect(upstreamCalls).toBe(0);
    expect(await persistedGeneratedBy(intakeId)).toEqual({
      generatedBy: "fixed_template",
      modelVersion: null,
    });
  });
});
