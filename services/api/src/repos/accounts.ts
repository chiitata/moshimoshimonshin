import type {
  AccountDoc,
  LegalConsentDoc,
  PatientProfileDoc,
} from "../domain/firestoreDocs.js";
import type { ConsentType } from "../domain/types.js";
import { getDoc, queryDocs } from "./helpers.js";
import type { FirestoreLike } from "./helpers.js";

export function accountRef(db: FirestoreLike, uid: string) {
  return db.doc(`accounts/${uid}`);
}

export async function getAccount(
  db: FirestoreLike,
  uid: string,
): Promise<AccountDoc | undefined> {
  const r = await getDoc<AccountDoc>(db, `accounts/${uid}`);
  return r.data;
}

export async function getProfile(
  db: FirestoreLike,
  uid: string,
): Promise<PatientProfileDoc | undefined> {
  const r = await getDoc<PatientProfileDoc>(db, `patientProfiles/${uid}`);
  return r.data;
}

export function profileRef(db: FirestoreLike, uid: string) {
  return db.doc(`patientProfiles/${uid}`);
}

export function consentsCollection(db: FirestoreLike) {
  return db.collection("legalConsents");
}

export async function listConsents(
  db: FirestoreLike,
  uid: string,
): Promise<Array<{ id: string; data: LegalConsentDoc }>> {
  const rows = await queryDocs<LegalConsentDoc>(
    db,
    "legalConsents",
    [{ field: "subjectUid", op: "==", value: uid }],
    { orderBy: [{ field: "occurredAt", direction: "desc" }], limit: 100 },
  );
  return rows.map((r) => ({ id: r.id, data: r.data }));
}

/**
 * 各 consentType の最新の granted 同意を返す。
 * revokedAt が設定された同意は撤回済みとして除外する。
 */
export function latestGrantedByType(
  consents: Array<{ id: string; data: LegalConsentDoc }>,
): Map<ConsentType, LegalConsentDoc> {
  const result = new Map<ConsentType, LegalConsentDoc>();
  for (const { data } of consents) {
    if (data.decision !== "granted" || data.revokedAt) continue;
    if (!result.has(data.consentType)) result.set(data.consentType, data);
  }
  return result;
}
