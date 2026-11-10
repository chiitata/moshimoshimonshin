# 新規登録者の自己専用・合成デモ（送信保存のみ）

## 境界

通常登録・ログインだけではデモbindingを作らない。メール確認、現行必須同意、必須プロフィールを完了した本人が、ホームの「合成デモを開始」→説明を確認→「架空情報のみで開始」を選択した場合だけ準備する。プロフィールも含め架空情報だけを使う。認証用メールは本人が受信・確認できるものを使い、実患者情報は入力しない。

これは実APIへの送信保存までのデモであり、病院側の閲覧・受領確認は対象外。職員アカウント・membership・招待は作らない。患者に職員権限や実施設のverificationを付与しない。配送の `delivered` は同期保存を表す既存契約のままで、デモ画面では「送信を保存しました。病院側閲覧・受領は未確認」と表示する。

## サーバ設定（レビュー後に別途承認して変更）

- `SYNTHETIC_SELF_SERVICE_ENABLED`: `true` / `false` のみ。未設定は **false**。クライアント設定やリクエストでは有効化できない。
- `SYNTHETIC_SELF_SERVICE_MAX_FACILITIES`: インストール全体の累積作成上限。既定1000、範囲1〜10000。Firestoreの単一カウンターを同一transactionで更新するため、複数APIインスタンスでも上限を守る。既存fixtureは数えない。
- 通常のApp Check・CORS・認証設定は変更しない。デモ作成は既存のactiveゲートと本人トークンの `emailVerified` を要求する。自己専用施設への新規配送もメール確認と上記フラグを再確認する。
- 新規作成の追加コストは専用施設・binding・累積カウンターの保存とtransaction読取。配送・同意・監査は既存APIと同じ。開始APIは本人単位5回/分（インスタンス内レート制限）、作成上限はDB上で強制。配送料・履歴量は既存の制限に従う。

### 今回の本番反映境界とTerraform drift

**今回の変更でTerraform applyは禁止。** 既存AI・CORS・secret等に本件以外の差異があり得るため、今回のflag反映を理由にTerraform全体の適用や既存envの置換をしない。実本番への登録・書込・メール・デプロイもレビュー承認前は禁止。

merge／API CD成功後、対象サービス・revision・既存設定を担当者が確認し、別途承認した限定操作として `--update-env-vars` で上記2変数だけを更新する。`--set-env-vars` による全env置換、AI/CORSの変更、secretの差し替え、workerの変更は対象外。患者Hostingの配信はAPI CDとは別であり、検証済みの同じ変更系列を別途承認して反映する。作成上限は承認値を明示し、未承認の環境をtrueにしない。停止も同じ限定更新で `SYNTHETIC_SELF_SERVICE_ENABLED=false` だけを反映し、他のenv・secretは維持する。

`infra/terraform/cloud_run.tf` はAPIの両envを宣言し、変数 `synthetic_self_service_enabled`（bool、既定false）と `synthetic_self_service_max_facilities`（整数1〜10000、既定1000）で管理する。将来の承認済みTerraform運用を再開する前に、環境ごとの承認済み有効状態・上限を運用者管理の入力へ記録し、限定更新した値と一致させる。宣言の追加だけで手動更新値が自動採用されるわけではなく、既定falseのまま将来applyすればfalseへ戻る。既存state・AI/CORS/secret等の差異も別途照合し、今回の手動反映を口実にstateや設定を上書きしない。認証情報・state・秘密値はコミットしない。

## API・永続化

`POST /v1/me/synthetic-demo`、本文は `{ "syntheticDataOnly": true }` のみ。UID・施設コード・職員UIDなどの追加フィールドは400。本人は検証済みトークンから決定する。成功200は次を返す。

```json
{
  "facilityId": "synthetic-self-<sha256-of-uid>",
  "syntheticRecipient": true,
  "verificationStatus": "pending",
  "mode": "storage_only",
  "hospitalViewing": "unconfirmed"
}
```

応答は `private, no-store`。UID由来の安定した施設IDで本人につき1施設とし、`facilities/{facilityId}` と `syntheticDemoPatients/{uid}` を同じtransactionでcreateする。bindingには明示opt-in時刻と `selfServiceVersion: 1` を保存。`syntheticDemoProvisioning/selfService.createdCount` は累積作成件数。再送は同じペアが有効なときだけ同じ応答を返し、カウンターを増やさない。サービスのtransaction内でもaccount・現行文書・必須同意を再検証する。

既存binding、片側だけの記録、他人所有、verified化、停止、マーカー不一致は409で停止し、修復・採用・上書きしない。特に既存 `synthetic-demo-taichi-20261109` の専用患者bindingを新規登録者へ付け替えない。未認証401、未確認メール/未完了プロフィール/停止アカウント403、必須同意不足・作成上限412、フラグoff404、レート超過429。

専用施設には `placeId` を付けず、名前・住所に架空と明記し、`pending`・`syntheticDemo: true`・`syntheticSelfService: true` とする。通常Places検索の実施設マッチングから合成施設を除外し、運営の実施設承認APIでも合成施設を拒否する。既存双方binding検証・共有範囲・施設別送信同意・現active membershipによる病院閲覧認可は維持する。

画面はAPI応答の専用コードを保持して表示し、デモ中はコードを編集できない。施設詳細でも同じコード・pending・本人のsyntheticRecipientを再確認する。施設詳細の `syntheticStorageOnly` がtrueの施設は、履歴から再選択しても送信保存のみと表示する。非デモ施設や別コードの応答では送信へ進まない。サインアウト・認証変更ではコードとデモ状態を破棄する。

## 停止・削除・制約

緊急停止はサーバフラグをfalseに戻す。新規準備と自己専用施設への新規送信が停止する。既存配送の同一キー再送は、保存済み結果を返す場合があり、保存済みデータの撤回や削除を意味しない。施設ごとの `receivingEnabled: false` も維持され、開始APIは勝手に再開しない。

既存account削除workerは、この機能のID・マーカー・所有者が一致するpending施設と専用bindingだけを冪等削除する。他人施設、実施設、旧fixtureは変更しない。専用bindingの版・参照先が不正なら、施設・bindingのいずれも削除せず409で運営確認を要求する。施設が既に消えていても不正bindingを残存なしと扱わず、通常削除段階・残存確認段階の両方で停止する。所有ペアの施設がverified化・不整合になっている場合も削除完了と偽らず、workerの既存失敗・再試行経路へ返す。配送・監査の保持は既存ポリシーどおり。累積カウンターは削除で補充せず、上限変更・残存異常の調査は承認済み運用として別途行う。自動TTLや病院受信担当の割当てはない。

## 検証

- API: `services/api` で `npm run typecheck`、`npm run lint`、`npm test`。
- Firebase Emulator: `npm run test:emulator` に `test/integration/syntheticDemo.emulator.test.ts` を含む。demoプロジェクト・ループバック専用環境で実行する。実Auth登録、Emulator上のメール確認、プロフィール、問診、共有同意、配送保存、病院認可拒否、同時開始、commit前失敗・再試行を検証する。
- Flutter: `apps/patient` で `flutter analyze`、`flutter test`。`test/synthetic_demo_screen_test.dart` は明示開始・キャンセル・API無効/不正応答・別コード/非デモ拒否・認証変更・同意・保存表示を検証する。
- 実画面＋実API: ルートで `SYNTHETIC_DEMO_UI_E2E=1 bash apps/patient/tool/run_public_registration_e2e.sh`。専用のloopback/demo環境を自動起動し、`test/integration/synthetic_demo_ui_e2e_test.dart` を明示有効化する。Flutter実画面と本物のPublicPatientApiを使用し、登録、Emulator確認コード、必須プロフィール、明示開始、実問診、共有同意、保存表示まで操作する。開始commit後の応答だけをテスト用transportで失わせ、画面から再試行して同じ施設IDとFirestore累積件数1を確認する。API成功応答や問診状態は偽造しない。
- CIの `patient-registration-e2e` 内に実画面デモの専用実行stepを設け、machine reporterの成功・完了を検証しskipを許可しない。通常の `flutter test` では外部プロセスが必要なこのテストをskipし、その件数を隠さない。単独のAPI-only登録試験やAPI-only Emulator試験を画面E2E成功とは扱わない。
- widgetの別回帰試験では、Aの開始応答を保留し、epochとtokenをともにBへ変更してBへログイン後にAの応答を解放する。Bの施設コード欄が空・編集可能で、Aの専用コードが残らないことを確認する。

実画面E2EはFlutter widget host上で実行する（実ブラウザのFirebase JS SDK試験ではない）。Auth操作は本物のローカルAuth Emulator REST、メール確認はEmulatorのOOBコードで行う。公開環境の実App Check、メール配信、CSP、CORSの受入を代用しない。本変更だけで本番登録・書込・メール送信・配信を実施してはいけない。
