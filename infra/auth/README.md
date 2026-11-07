# Firebase Authの設定と受入（#34）

対象は `project-7efcc4c4-6c86-490c-ba5` の単一project。
Auth/App Check/業務APIの受入を別々に確認し、設定値の存在だけでログイン成功や職員MFA強制を完了扱いにしない。
秘密値、UID、メールアドレス、OAuth client secret、TOTP seed/QR/復旧情報はGit/Issue/ログへ載せない。

## TOTP MFAを利用可能にする

`configure.py` はPython標準ライブラリとgcloudだけを使う。既定は読み取り専用で、資格情報やAuth設定全体を出力しない。
実行者には対象projectのAuth設定の読取権限、適用時は更新権限も必要。

```sh
python3 infra/auth/configure.py --project project-7efcc4c4-6c86-490c-ba5
# 構成レビュー後、TOTPを利用可能にする場合のみ
python3 infra/auth/configure.py --project project-7efcc4c4-6c86-490c-ba5 --enable-totp
```

Identity Platformへのアップグレード済みであることを確認する。未実施ならツールは停止する。
アップグレードの料金/利用条件は管理者が確認し、Consoleで実施する。このツールは料金プランやproject subtypeを変更しない。
TOTPはSMSを追加せず、初回の許容時間窓は前後1区間。既存のTOTP時間窓・他factorを維持する。
更新maskは `mfa.state,mfa.providerConfigs` のみで、既存の全体MANDATORYを弱めない。
患者を含む全員へMANDATORYを新規設定しない。職員への強制は職員セッション/APIの責務。
適用後は独立したGETでTOTP有効を確認し、不一致・通信/権限エラーは失敗終了する。

Auth Console/別ツールとの同時更新は止めて実行する。APIに本ツールが利用できる楽観ロックはなく、providerConfigsは配列全体を更新する。
直前のMFA設定を管理者の限定保管先に記録し、誤設定時は管理者がMFAの該当項目だけ復元する。
ユーザーのfactorを一括削除したり、MFAを無効にしてログイン障害を迂回したりしない。
有効化は既存ユーザーの登録やログインを実施しないため、次の受入が必要。

1. #82の職員画面で合成テストアカウントをメール確認後にTOTP登録し、ログアウト→第一要素→TOTPで再ログインする。
2. 正規Firebase tokenのsecond factorを職員セッションで検証し、第一要素のみ/メール未確認/所属なし/所属失効を拒否する。
3. 誤コード・期限切れ・未登録・時計ずれ・再認証切れ・紛失復旧の結果を確認する。seedやコードは記録しない。
4. 患者のEmail/Googleログインに職員向けの一律MFA必須が掛かっていないことを確認する。

## Provider / OAuth / メール

| 対象 | 設定と確認 |
|---|---|
| Email/Password | Firebase Consoleで有効、実クライアントで登録/検証/ログイン/再認証/パスワード再設定を合成アカウントだけで試験 |
| Google | Provider有効と管理者承認済みサポート情報を確認。secretをCLI出力しない |
| Web | 実配信するhostだけをAuthorized domainsへ登録し、許可/不許可redirectを確認。架空domainを登録しない |
| Android | 配布対象の実applicationIdと署名SHA-1/SHA-256を登録。debug鍵と配布鍵を区別し、実署名でログイン確認 |
| iOS | 実bundle ID、URL scheme、Google設定ファイルを照合し、配布対象でログイン確認 |
| メール | 検証/再設定/メール変更通知のテンプレートをConsoleで日本語に整備。承認済みの送信元・返信先・action URL・サポート連絡先を使用 |

メール文面には診療/問診/施設情報を含めず、サービス名、操作目的、有効なリンク、心当たりがない場合の案内だけを入れる。
実送信は許可済みテスト宛先に限定し、期限切れ/再利用/不許可continue URLを拒否することを確認する。
送信ドメインのDNS/到達性、各署名・連絡先はコードから推測しない。未確定の値はブロッカーとして記録する。

## Role / 失効 / 不審ログイン

`services/api/src/auth/gates.ts` の `requireFacilityRole` / `requirePlatformSecurityAdmin` は
Firestoreのactive membershipを正本とする。custom claimsへ施設一覧を複製したり、claimだけで権限を追加しない。
現APIはrole custom claimを使っていない。設計書§5.3のclaim突合を実装済みとは主張しない。
将来claimを使う場合もmembership照合を残し、付与/剥奪主体、更新遅延、再発行、監査を別PRで定義する。

APIのtoken検証は `services/api/src/auth/verifiers.ts` と `gates.ts` の失効検査を使用。
退会/再認証は `services/api/src/services/deletion.ts`、`workers/deletionJob.ts`、`requireFreshAuth` を参照する。
侵害時は管理者が対象を同定してセッション失効・アカウント停止・membership失効・監査確認を行い、
復旧時にメール所有権とMFAを再確認する。全ユーザーの一括失効を通常の設定操作に含めない。
メール列挙防止やpassword policyは既存クライアント契約と照合した別の設定レビューで扱う。

## 自動検証と完了条件

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s infra/auth -p 'test_*.py' -v
```

このテストはネットワーク/実メール送信なし。設定の限定更新・別project拒否・秘密非出力・冪等性・読取確認失敗を検証する。
上のProvider/OAuth/メール/職員MFA/失効の実環境受入を記録し、PRが承認・マージされてから#34をcloseする。

## 一次資料

- [Firebase TOTP MFAとIdentity Platform要件](https://firebase.google.com/docs/auth/web/totp-mfa)
- [Auth configの限定PATCHとupdateMask](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects/updateConfig)
- [Auth Configのsubtype・メール等の項目](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/Config)
