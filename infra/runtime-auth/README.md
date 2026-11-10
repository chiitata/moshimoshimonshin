# APIのFirebase Authユーザー権限

実公開ログインで、有効なFirebase ID tokenに対してAPIが401を返す問題を切り分ける。
`AdminAuthVerifier.verifyIdToken(token, true)` は署名検証だけでなくAuthユーザー状態を読む。
[GetAccountInfoの必要権限](https://docs.cloud.google.com/identity-platform/docs/access-control) は
`firebaseauth.users.get`。API runtimeの既存datastore/cloudtasks権限だけでは満たせない。

このrootはcustom roleとAPI SAへの非排他的IAM memberの2件だけを管理する。
roleの権限は `firebaseauth.users.get`（失効・無効ユーザーの検証）、
`firebaseauth.users.create`、`firebaseauth.users.update` に限定する。
Auth設定変更、ハッシュ参照、ユーザー削除、運営権限は含めない。
既存SAそのものやAPI runtimeをimport・再管理しない。旧rootにも同じrole/bindingを追加しない。
本番project `project-7efcc4c4-6c86-490c-ba5` には承認済み変更として上記3権限が追加され、
既存の `firebaseauth.users.get` と `api-run-sa` へのbindingは維持された。
本rootのTerraform state/backendの所在・対応関係は未確認のため、ここからinit/plan/applyしない。
state/保存planは公開しない。将来のTerraform操作はbackend/stateの所有者と同期状態を確認してから行う。

権限付与だけではユーザー作成・再有効化workerの実装や受入を保証しない。
退会は削除権限を含めないため、公開前に実装ごとの必要権限と受入を別途確認する。
