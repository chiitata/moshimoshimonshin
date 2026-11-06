import type { Deps } from "../deps.js";
import { AUDIT_ACTIONS } from "../domain/auditEvents.js";
import { audit, auditResourceHash, auditUidHash } from "../lib/audit.js";
import { ApiError } from "../lib/errors.js";
import { requestHash, runIdempotent } from "../lib/idempotency.js";
import {
  deletePushDevice,
  getPushDevice,
  pushDeviceIdForToken,
  upsertPushDeviceInTx,
} from "../repos/pushDevices.js";
import type { DeviceRegisterBody } from "../domain/schemas.js";

/**
 * API-042 POST /me/devices。
 * FCMトークンを登録する。deviceId はトークンから決定論的に導出されるため
 * 再登録・トークンローテーションは同一docの更新として冪等に処理される。
 */
export async function registerDevice(
  deps: Deps,
  params: {
    uid: string;
    body: DeviceRegisterBody;
    idempotencyKey: string;
    requestId?: string;
  },
): Promise<{ deviceId: string }> {
  const deviceId = pushDeviceIdForToken(deps, params.body.token);
  const { replayed } = await runIdempotent<{ deviceId: string }>(deps, {
    namespace: "push_device_register",
    key: params.idempotencyKey,
    principal: params.uid,
    requestHash: requestHash(deps, params.body),
    execute: async (tx) => {
      await upsertPushDeviceInTx(
        tx,
        deps.db.doc(`pushDevices/${deviceId}`),
        {
          patientUid: params.uid,
          token: params.body.token,
          platform: params.body.platform,
        },
      );
      return { deviceId };
    },
  });
  if (!replayed) {
    await audit(deps, {
      actorType: "patient",
      actorUidHash: auditUidHash(deps, params.uid),
      action: AUDIT_ACTIONS.PUSH_DEVICE_REGISTERED,
      resourceType: "pushDevices",
      resourceIdHash: auditResourceHash(deps, deviceId),
      details: { platform: params.body.platform },
      ...(params.requestId ? { requestId: params.requestId } : {}),
    });
  }
  return { deviceId };
}

/**
 * API-043 DELETE /me/devices/{deviceId}。
 * 本人所有のデバイスのみ削除。存在しない・他人所有は404で存在秘匿。
 */
export async function unregisterDevice(
  deps: Deps,
  params: { uid: string; deviceId: string; requestId?: string },
): Promise<void> {
  const doc = await getPushDevice(deps.db, params.deviceId);
  if (!doc.exists || !doc.data || doc.data.patientUid !== params.uid) {
    throw ApiError.notFound("デバイスが見つかりません。");
  }
  await deletePushDevice(deps.db, params.deviceId);
  await audit(deps, {
    actorType: "patient",
    actorUidHash: auditUidHash(deps, params.uid),
    action: AUDIT_ACTIONS.PUSH_DEVICE_UNREGISTERED,
    resourceType: "pushDevices",
    resourceIdHash: auditResourceHash(deps, params.deviceId),
    details: { platform: doc.data.platform },
    ...(params.requestId ? { requestId: params.requestId } : {}),
  });
}
