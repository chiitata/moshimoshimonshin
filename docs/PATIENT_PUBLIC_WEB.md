# 患者Webの公開接続と配信

公開接続の入口は `apps/patient/lib/main_public.dart`。初回利用者はログイン画面から新規登録へ進み、公開APIの最新規約を確認して必須同意した後に登録します。登録API成功後にFirebase Authでサインインし、メール確認と残りのオンボーディングを行います。既存の `main.dart` はローカルエミュレータ用です。

指定プロジェクトは `project-7efcc4c4-6c86-490c-ba5`、Hostingサイトは `moshimoshi-patient-842827776169` です。
公開先は https://moshimoshi-patient-842827776169.web.app です。サイトの存在やビルド成功だけでは実接続の受入完了とは扱いません。

## ビルドと配信

リポジトリ直下の無視対象 `.local/patient-web.json` に次の公開設定を保存します。パスワード・秘密鍵・Auth/App Checkトークンを含めないでください。これらのビルド設定はブラウザから読めます。

- `FIREBASE_PROJECT_ID`: 上記の指定プロジェクト
- `FIREBASE_APP_ID`: 登録済みPatient WebのFirebase App ID
- `FIREBASE_API_KEY`: 同アプリのSDK公開キー
- `FIREBASE_AUTH_DOMAIN`: 同アプリのSDK設定のAuthドメイン
- `APP_CHECK_SITE_KEY`: 公開ドメイン限定のreCAPTCHA Enterpriseサイトキー
- `API_BASE_URL`: 実APIのHTTPS origin（パス・末尾スラッシュなし）
- `PATIENT_FACILITY_ID`: 任意。実際に受信する施設コード

Auth許可ドメイン、Firebase App CheckのEnterprise設定、APIの `API_CORS_ORIGINS` に公開originを登録します。App Checkの無効化やDebug providerへの置換で受入を代用しません。

```sh
cd apps/patient
flutter analyze
flutter test
flutter build web --release --csp --no-web-resources-cdn \
  --target lib/main_public.dart \
  --dart-define-from-file ../../.local/patient-web.json
cd ../..
firebase deploy --project project-7efcc4c4-6c86-490c-ba5 \
  --config firebase.patient.json --only hosting
```

この専用設定は患者サイトを配信します。HTML・JSを含む全応答を `no-store` にし、PHIの端末永続化を避けます。Authはメモリ永続化です。CSPは実API、Firebase SDK、reCAPTCHAとFlutterの描画に必要な接続先を許可します。Firebaseのモジュールは外部の `web/firebase_bootstrap.js` で先に読み込み、FlutterFireのinline loaderを使いません。依存更新時は同ファイルのSDK版を `firebase_core_web` の `supportedFirebaseJsSdkVersion` と合わせ、実ブラウザ試験を再実行します。

Terraformを適用するときは `cors_origins` に既存originと患者公開originの両方を指定してください。今回のAPI CORS変更を既定値で巻き戻さないでください。配信前のビルドと設定を記録し、ロールバック時は直前の検証済みHostingリリースへ戻します。

## 受入

合成データだけでログイン→問診→質問回答→レビュー→確定→施設確認→明示同意付き送信→病院受信→ログアウトを確認します。実ブラウザでAuthとApp Checkの実トークン取得・CSP違反・API CORS・レスポンスヘッダも確認してください。トークンや入力内容をログに残さないでください。

実API・Firebase Emulatorを使う試験は `apps/patient/tool/run_intake_e2e.sh` です。実クラウドのApp Check受入を代用しません。このスクリプトは固定ポート（8080、8081、9000、9099、9199）を使って起動・停止するため、既存の共有ローカル環境と互換ではありません。専用かつ他プロセスから隔離された使い捨て環境でのみ実行してください。`E2E_DISPOSABLE_RUNNER=1` は操作者の自己申告にすぎず、隔離を強制・検証しません。ポート事前確認にもTOCTOU競合があり、同じポートを他プロセスが使わない保証にはなりません。iOSの署名・配布手順は [IOS_DISTRIBUTION.md](IOS_DISTRIBUTION.md) を参照してください。

App Checkトークンを取得できない場合（SDK例外・空トークン）は、患者画面にアプリの安全性を確認できない旨と再試行方法を表示し、APIを送信しません。ログイン期限切れや入力不備とは区別し、SDKの詳細メッセージは表示しません。この案内はApp Checkの拒否原因を特定したり、トークン取得失敗を解消したりするものではありません。

## 施設確認・共有同意後も送信ボタンが無効な場合

共有同意だけでは送信可能になりません。患者が認証した施設詳細APIの応答に対し、`receivingEnabled == true` かつ（`verificationStatus == "verified"` または `syntheticRecipient == true`）が必要です。フィールド欠落も許可として扱いません。

- 合成pending施設の例外は、サーバー管理の施設マーカー・専用患者UID・`syntheticDemoPatients` の施設バインディングがすべて一致する患者だけです。通常の新規登録でこのバインディングは付与されません。実患者や別患者を合成施設へ結び付けて復旧を代用してはいけません。
- 合成デモの設定は [合成アカウント作成手順](../services/api/scripts/SYNTHETIC_DEMO_ACCOUNTS.md) に従い、信頼できる運用者が未使用の合成IDで施設・専用患者・バインディングをまとめて新規作成します。既存施設へ通常の登録患者を後付けする手順ではありません。既存の専用合成患者を使う場合も、秘密情報を共有せず運用者が正しいアカウントを確認します。
- 受付が有効でも施設の利用条件を満たさない場合は「このアカウントでは、この施設への送信が許可されていません」と表示します。この表示だけではバインディング欠落・別患者・通常の未確認施設のどれかを特定できません。
- 受付停止・バインディング不一致は意図した拒否です。許可された合成テスト患者だけで施設詳細を再取得し、上記3つの判定値を確認します。トークン、患者UID、問診・プロフィール本文、ブラウザのネットワーク記録全体を共有しないでください。送信POSTによる切り分けは不要です。
- 施設詳細は `private, no-store` ですが、画面で確認済みの値は再取得するまで更新されません。受付設定変更後は再び「施設を確認」を押します。バックエンドは配送作成時にも最新状態を再検証します。
- APIのCD成功は患者Webの更新を意味しません。患者Webは上記の別配信です。配信したコミット・公開JSのハッシュ・応答ヘッダを別々に確認し、フロント/APIの片方だけを戻さないでください。

拒否の再現だけを根拠に、施設のverified化、受付有効化、バインディングの追加、同意・認可条件の削除をしてはいけません。許可すべき患者でも施設詳細の判定値が拒否になっている場合は、承認された合成リソースだけを運用者が確認する必要があります。
