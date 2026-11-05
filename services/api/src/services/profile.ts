import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import type { Deps } from "../deps.js";
import type {
  AccountDoc,
  PatientProfileDoc,
} from "../domain/firestoreDocs.js";
import {
  profilePatchSchema,
  REQUIRED_PROFILE_FIELDS,
  type ProfilePatch,
} from "../domain/schemas.js";
import { ApiError, assertParsed } from "../lib/errors.js";
import { getProfile, profileRef } from "../repos/accounts.js";

export interface ProfileResponse {
  profile: Record<string, unknown>;
  profileComplete: boolean;
}

/** API-003 GET /me/profile。 */
export async function getMyProfile(
  deps: Deps,
  uid: string,
): Promise<ProfileResponse> {
  const profile = await getProfile(deps.db, uid);
  if (!profile) {
    throw ApiError.notFound("プロフィールが登録されていません。");
  }
  const { patientUid: _ignored, ...rest } = profile;
  return {
    profile: rest as Record<string, unknown>,
    profileComplete: profile.profileComplete,
  };
}

/**
 * API-002 PATCH /me/profile。
 * 部分更新を許し、必須項目が揃った時点で onboarding を完了に進める（BR-02）。
 */
export async function patchMyProfile(
  deps: Deps,
  uid: string,
  body: unknown,
): Promise<ProfileResponse> {
  const patch: ProfilePatch = assertParsed(
    profilePatchSchema.safeParse(body),
  );
  if (Object.keys(patch).length === 0) {
    throw ApiError.validation([
      { field: "(body)", message: "更新項目がありません。" },
    ]);
  }

  return deps.db.runTransaction(async (tx) => {
    const accountRef = deps.db.doc(`accounts/${uid}`);
    const accountSnap = await tx.get(accountRef);
    if (!accountSnap.exists) {
      throw ApiError.forbidden("アカウントが初期化されていません。");
    }
    const account = accountSnap.data() as AccountDoc;
    if (
      account.accountStatus !== "onboarding_pending" &&
      account.accountStatus !== "active"
    ) {
      throw ApiError.forbidden("このアカウント状態ではプロフィールを更新できません。");
    }

    const ref = profileRef(deps.db, uid);
    const existingSnap = await tx.get(ref);
    const ts = FieldValue.serverTimestamp();

    const updates: Record<string, unknown> = { updatedAt: ts };
    if (patch.familyName !== undefined) updates.familyName = patch.familyName;
    if (patch.givenName !== undefined) updates.givenName = patch.givenName;
    if (patch.familyNameKana !== undefined) {
      updates.familyNameKana = patch.familyNameKana;
    }
    if (patch.givenNameKana !== undefined) {
      updates.givenNameKana = patch.givenNameKana;
    }
    if (patch.birthDate !== undefined) updates.birthDate = patch.birthDate;
    if (patch.phoneNumber !== undefined) updates.phoneNumber = patch.phoneNumber;
    if (patch.postalCode !== undefined) updates.postalCode = patch.postalCode;
    if (patch.address !== undefined) updates.address = patch.address;
    if (patch.allergyStatus !== undefined) {
      updates.allergyStatus = patch.allergyStatus;
    }
    if (patch.locale !== undefined) updates.locale = patch.locale;
    if (patch.medicalHistory !== undefined) {
      updates.medicalHistory = patch.medicalHistory.map((text) => ({
        conditionText: text,
        selfReported: true,
        updatedAt: ts,
      }));
    }

    const merged: PatientProfileDoc = {
      ...(existingSnap.exists
        ? (existingSnap.data() as PatientProfileDoc)
        : ({ patientUid: uid, locale: "ja-JP" } as PatientProfileDoc)),
      ...(updates as Partial<PatientProfileDoc>),
    };
    merged.profileComplete = REQUIRED_PROFILE_FIELDS.every(
      (f) => merged[f] !== undefined && merged[f] !== null && merged[f] !== "",
    );

    if (!existingSnap.exists) {
      tx.set(ref, merged as unknown as DocumentData);
    } else {
      tx.update(ref, { ...updates, profileComplete: merged.profileComplete });
    }

    // プロフィール完了でアカウントを active へ進める（同意はゲートで現行確認済み）
    if (merged.profileComplete && account.onboardingState !== "completed") {
      tx.update(accountRef, {
        accountStatus: "active",
        onboardingState: "completed",
        updatedAt: ts,
      });
    }

    const { patientUid: _ignored, ...rest } = merged;
    return {
      profile: rest as Record<string, unknown>,
      profileComplete: merged.profileComplete,
    };
  });
}
