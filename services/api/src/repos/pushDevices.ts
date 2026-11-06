import {
  FieldValue,
  type DocumentData,
  type DocumentReference,
  type Transaction,
} from "firebase-admin/firestore";
import type { PushDeviceDoc } from "../domain/firestoreDocs.js";
import { getDoc, queryDocs } from "./helpers.js";
import type { FirestoreLike } from "./helpers.js";
import { hmacParts } from "../lib/hash.js";
import type { Deps } from "../deps.js";

/** 1ユーザーあたりの送信対象デバイス上限（異常な登録数による送信増幅を抑止）。 */
export const PUSH_DEVICE_SEND_LIMIT = 20;

/**
 * deviceId を FCM トークンから決定論的に導出する。
 * 同一トークンの再登録は同じ doc を更新するため冪等。
 * トークン自体を doc id に使わない（長さ・文字種・列挙耐性のため）。
 */
export function pushDeviceIdForToken(deps: Deps, token: string): string {
  return `pdv_${hmacParts(deps.config.hmacSecret, "push-device", token)}`;
}

export async function getPushDevice(
  db: FirestoreLike,
  deviceId: string,
): Promise<{ exists: boolean; data: PushDeviceDoc | undefined }> {
  return getDoc<PushDeviceDoc>(db, `pushDevices/${deviceId}`);
}

/**
 * デバイス登録のupsert（呼び出し元のトランザクション内で実行）。
 * 既存docがあれば ownership を最新の登録者に更新する（トークンは
 * アプリインストールに紐づき、アカウント切替時は最後に登録した
 * ユーザーが受信者となる）。FCMが一度 unregistered を返した
 * トークンも再登録で active に復活させる。
 */
export async function upsertPushDeviceInTx(
  tx: Transaction,
  ref: DocumentReference,
  params: {
    patientUid: string;
    token: string;
    platform: PushDeviceDoc["platform"];
  },
): Promise<void> {
  const now = FieldValue.serverTimestamp();
  const snap = await tx.get(ref);
  if (!snap.exists) {
    const doc: PushDeviceDoc = {
      patientUid: params.patientUid,
      token: params.token,
      platform: params.platform,
      status: "active",
      invalidatedReason: null,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
    };
    tx.create(ref, doc as unknown as DocumentData);
    return;
  }
  await tx.update(ref, {
    patientUid: params.patientUid,
    token: params.token,
    platform: params.platform,
    status: "active",
    invalidatedReason: null,
    updatedAt: now,
    lastSeenAt: now,
  });
}

/** 送信対象の active デバイスを列挙する。 */
export async function listActivePushDevices(
  db: FirestoreLike,
  patientUid: string,
): Promise<Array<{ id: string; data: PushDeviceDoc }>> {
  return queryDocs<PushDeviceDoc>(db, "pushDevices", [
    { field: "patientUid", op: "==", value: patientUid },
    { field: "status", op: "==", value: "active" },
  ], { limit: PUSH_DEVICE_SEND_LIMIT });
}

/** FCM がトークン失効を返したデバイスを無効化する。 */
export async function invalidatePushDevice(
  db: FirestoreLike,
  deviceId: string,
  reason: string,
): Promise<void> {
  await db.doc(`pushDevices/${deviceId}`).update({
    status: "invalid",
    invalidatedReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

/** 本人のデバイス解除。存在しない・他人所有は呼び出し側で404にする。 */
export async function deletePushDevice(
  db: FirestoreLike,
  deviceId: string,
): Promise<void> {
  await db.doc(`pushDevices/${deviceId}`).delete();
}
