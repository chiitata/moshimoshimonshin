import type { DocumentSnapshot } from "firebase-admin/firestore";
import type { DeletionJobDoc, OcrJobDoc } from "../domain/firestoreDocs.js";
import { queryDocs } from "./helpers.js";
import type { FirestoreLike } from "./helpers.js";

/**
 * 失敗ジョブ一覧（API-038, FR-O04）。
 * patientUid / subjectUid / uploadId などの個人紐付け識別子は
 * 返さない。一覧は jobId・失敗分類・時刻のみ。
 */
export interface JobFailureItem {
  type: "ocr" | "deletion";
  jobId: string;
  failureCode: string | null;
  attempts: number;
  /** ISO8601。時刻未設定の場合は null。 */
  failedAt: string | null;
}

export interface JobFailurePage {
  items: JobFailureItem[];
  nextCursor: string | null;
}

const toIsoOrNull = (v: unknown): string | null => {
  if (
    v !== null &&
    typeof v === "object" &&
    "toDate" in v &&
    typeof (v as { toDate?: unknown }).toDate === "function"
  ) {
    return (v as { toDate: () => Date }).toDate().toISOString();
  }
  return null;
};

/** スナップショットカーソルの解決。対象コレクション・失敗状態以外は空ページ。 */
async function resolveCursor(
  db: FirestoreLike,
  path: string,
  requireFailed: (data: Record<string, unknown>) => boolean,
): Promise<DocumentSnapshot | null> {
  const snap = await db.doc(path).get();
  const data = snap.data() as Record<string, unknown> | undefined;
  if (!snap.exists || !data || !requireFailed(data)) return null;
  return snap;
}

/** OCR失敗ジョブ（updatedAt 降順）。 */
export async function listFailedOcrJobs(
  db: FirestoreLike,
  opts: { cursor?: string; limit: number },
): Promise<JobFailurePage> {
  let startAfterDoc: DocumentSnapshot | undefined;
  if (opts.cursor) {
    const cur = await resolveCursor(
      db,
      `ocrJobs/${opts.cursor}`,
      (d) => d["status"] === "failed" && d["updatedAt"] != null,
    );
    if (cur === null) return { items: [], nextCursor: null };
    startAfterDoc = cur;
  }
  const rows = await queryDocs<OcrJobDoc>(
    db,
    "ocrJobs",
    [{ field: "status", op: "==", value: "failed" }],
    {
      orderBy: [{ field: "updatedAt", direction: "desc" }],
      ...(startAfterDoc ? { startAfterDoc } : {}),
      limit: opts.limit + 1,
    },
  );
  const items = rows.slice(0, opts.limit).map((r) => ({
    type: "ocr" as const,
    jobId: r.id,
    failureCode: r.data.errorCode,
    attempts: r.data.attempt,
    failedAt: toIsoOrNull(r.data.updatedAt),
  }));
  return {
    items,
    nextCursor: rows.length > opts.limit ? items[items.length - 1]!.jobId : null,
  };
}

/** 削除失敗ジョブ（requestedAt 降順）。 */
export async function listFailedDeletionJobs(
  db: FirestoreLike,
  opts: { cursor?: string; limit: number },
): Promise<JobFailurePage> {
  let startAfterDoc: DocumentSnapshot | undefined;
  if (opts.cursor) {
    const cur = await resolveCursor(
      db,
      `deletionJobs/${opts.cursor}`,
      (d) => d["status"] === "failed" && d["requestedAt"] != null,
    );
    if (cur === null) return { items: [], nextCursor: null };
    startAfterDoc = cur;
  }
  const rows = await queryDocs<DeletionJobDoc>(
    db,
    "deletionJobs",
    [{ field: "status", op: "==", value: "failed" }],
    {
      orderBy: [{ field: "requestedAt", direction: "desc" }],
      ...(startAfterDoc ? { startAfterDoc } : {}),
      limit: opts.limit + 1,
    },
  );
  const items = rows.slice(0, opts.limit).map((r) => ({
    type: "deletion" as const,
    jobId: r.id,
    failureCode: r.data.lastErrorCode,
    attempts: r.data.attemptCount,
    failedAt: toIsoOrNull(r.data.lastStartedAt ?? r.data.requestedAt),
  }));
  return {
    items,
    nextCursor: rows.length > opts.limit ? items[items.length - 1]!.jobId : null,
  };
}
