# もしもし問診 — 設計ドキュメント集

改訂：2026-11-06 / 審査用架空デモ向け改訂案

本リポジトリには設計書・環境構築手順・運用ガイドを含みます。医療・法務・契約・料金は正式承認前のドラフトです。

## 今回のデモでの読み方

- [01_要件定義書](01_要件定義書.md) と [03_機能仕様書](03_機能仕様書.md) は、審査用の架空デモを対象とする改訂案です。実装済み・検証済み・公開済みを意味しません。
- [ADR-0023](adr/0023_審査用架空デモの方針.md) は、架空データ・模擬連携、公開前の安全確認、正式運用との境界を示す**提案**です。
- **archive/ は旧版スナップショットです**。従来文書の保存コピーは [archive/2026-11-05-v1.1](archive/2026-11-05-v1.1/ARCHIVE_NOTICE.md) にあります。旧版の正式運用要件をそのままデモの完了条件にしません。既存の設計・DB・セキュリティ等の資料は実装の参考として残しますが、旧版由来の要件を自動的にデモ必須としません。
- [07_環境構築手順書](07_環境構築手順書.md)・[08_Docker_Makefile運用](08_Docker_Makefile運用.md)・[09_USEFUL_COMMANDS](09_USEFUL_COMMANDS.md)・[Nix開発環境](Nix開発環境.md) は**現行の開発・操作手順**として維持します。デモの開発・検証作業の手順であり、本番実行の承認を意味しません。
- 審査用公開も実環境であるため、架空であることの表示、実データ禁止、秘密保護、アクセス範囲、誤接続防止等を公開前に確認します。公開経路・対象・期間は未確定です。

1. [01_要件定義書](01_要件定義書.md)
2. [02_システム設計書](02_システム設計書.md)
3. [03_機能仕様書](03_機能仕様書.md)
4. [04_DB設計書](04_DB設計書.md)
5. [05_コスト試算表](05_コスト試算表.md)
6. [06_医療安全_セキュリティ_運用設計書](06_医療安全_セキュリティ_運用設計書.md)
7. [07_環境構築手順書](07_環境構築手順書.md)
8. [08_Docker_Makefile運用](08_Docker_Makefile運用.md)
9. [09_USEFUL_COMMANDS](09_USEFUL_COMMANDS.md)
10. [10_デザインシステム](10_デザインシステム.md)
11. [Nix開発環境](Nix開発環境.md)

意思決定記録（ADR）: [adr/](adr/README.md)

## 旧版の変更履歴（v1.1）

- 副作用APIの冪等ヘッダーは **`Idempotency-Key`** へ統一（従来の`X-Idempotency-Key`は廃止）。
- メール新規登録 **P-004** は同意チェックを登録フォームに統合。サーバ `POST /auth/register` で同意と文書版を**Admin SDK起動前**に検証し、同意済みの場合だけFirebase Authユーザーを作成してFirestoreに必要情報を保存。
- Google/Passkeyはプロバイダ認証後、初回の **P-002**（追加情報・必須同意）を通す。同意済みならP-006プロフィール登録。すべての業務APIは有効な同意を確認。
- **`POST /consents` は廃止**。初回メールの同意は `/auth/register`、Google/Passkey初回・規約改定時の同意は `/onboarding/consents` に統合。履歴参照 `GET /consents` は存続。
- AuthとFirestoreに横断トランザクションはないため、`registrationOperations`、安全な冪等処理、未完了アカウントの利用制限と修復手順を追加。
- Admin SDKは**Cloud Run/専用Workerのみ**で使用し、患者アプリ/病院ブラウザにはFirebase Client SDKのみを配置する。

### 実装時に必ず検証すること

- Firebase Auth/Firestore間の失敗注入試験、既存メールとの衝突、認証前APIの不正利用対策、Google/Passkeyで先行生成したUIDの休眠/削除ポリシー。
- Passkey新規登録には本人確認・アカウント復旧方式の設計承認が別途必要。未承認なら公開しない。
- 同意文面の法務審査、医療データの処理リージョン、医療機関ごとの個別提供同意は従来どおり本番公開ゲートとする。

## 参考実装資料

- [Firebase Admin SDK: Manage Users](https://firebase.google.com/docs/auth/admin/manage-users)
- [Firebase Authentication: Custom Tokens](https://firebase.google.com/docs/auth/admin/create-custom-tokens)
- [Firebase App Check: Custom Backend](https://firebase.google.com/docs/app-check/custom-resource-backend)
- [Cloud Firestore: Transactions](https://firebase.google.com/docs/firestore/manage-data/transactions)

## CI運用

- [依存関係・シークレット・コンテナの検査](DEPENDENCY_SECURITY_CI.md)
