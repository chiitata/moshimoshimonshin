# API監視の構成と受入（#39 / #26）

`infra/terraform/monitoring.tf` は単一project `project-7efcc4c4-6c86-490c-ba5` の
Cloud Run `api`、指定regionに限定した監視を定義する。既定は `enable_api_monitoring=false` で作成しない。
実環境への適用・通知到達・全監視要件の完了は、この定義だけでは保証しない。

## 指標と限界

| 項目 | 定義 |
|---|---|
| リクエスト | Cloud Run request logの `/v1/`。`next-question` とOPTIONSを除く。healthzは含まない |
| エラー | 同じ母集団のHTTP 500–599。4xxは可用性の失敗に数えない |
| 可用性SLO | 30日rollingの非5xx率99.5%。log metricのbad/totalで評価 |
| エラー通知 | 5分整列の5xx/全件比率が2%超で5分継続 |
| 遅延通知 | 各revisionの5分p95の最大が1.5秒超で5分継続。秒単位の分布metricを使用 |
| ダッシュボード | 件数rate・5xx rate・revision最大p95・測定範囲/未完条件 |

revisionごとのp95の最大はサービス全体の厳密なp95ではなく、遅いrevisionを見落とさない保守的な指標。
分布のbucket境界に1.5秒を含める。ログ遅延・欠測・無通信・request log未生成の障害を成功と扱わない。
実アクセス前/metric作成前へ遡った評価は保証しない。独立したuptime/外形監視は未実装。

metricラベルにURL・クエリ・UID・施設ID・問診内容を抽出しない。元ログの保持/閲覧権限は別途制御する。
新たなログ本文の出力はない。構造化ログ/相関IDは `services/api/src/app.ts` の `genReqId` と `lib/requestId.ts` を参照。

## 適用前

1. [Terraform引継ぎ手順](../terraform/REBUILD.md)で既存state・実資源・同名metric/SLO/alert/dashboardを照合し、既存資源はimportする。
2. Logging/Monitoring APIとrequest log生成を確認する。log-based custom metricの利用量・費用を確認する。識別情報をlabelにしないが、無料とは仮定しない。
3. 実在して利用可能な通知channel、SEV2/3の一次担当/代理者・当番時間・エスカレーション先を確認する。個人アドレス/Webhook秘密値をGitへ載せない。
4. ローカルtfvarsに `enable_api_monitoring=true` と確認済みchannel名を設定する。`projects/PROJECT_ID/notificationChannels/ID` を使い、別projectは拒否する。

通知channelが空ならSLO/metric/dashboardを作成できるが、両アラートはdisabledとなる。
これを「通知稼働済み」と報告しない。通知channel作成・IAM変更・通知テスト送信は本構成に含めない。

```sh
cd infra/terraform
export TF_VAR_project_id="project-7efcc4c4-6c86-490c-ba5"
terraform init -backend=false -input=false -lockfile=readonly
terraform fmt -check
terraform validate
```

上記はbackendなしclean checkoutの構文検証専用。実適用時はREBUILD.mdに従って正しいbackendを初期化し、
全体planをレビューして同じ保存planをapplyする。`-target` の限定planを本番受入や全体の安全性証明に使わない。

## 適用後の合成受入

1. metric descriptor、Cloud Run resource/region/serviceの一致、dashboard表示を確認する。
2. 合成アカウントで安全な通常API操作を行いrequest countへ計上されること、next-question/preflight/healthzを除外することを確認する。
3. 実業務を壊さない管理者承認の障害試験で、比率/遅延アラート発火・実通知到達・当番受領・復旧を確認する。通常データで障害を作らない。
4. 無通信・遅延ログ・revision更新を評価し、トラフィックがない期間にSLO達成を宣言しない。

SEV1は漏えい/誤配送/広範な削除失敗の事故手順を優先。5xxはSEV2候補、遅延のみならSEV3候補とし、患者影響で引き上げる。
通知だけで事故分類や法定報告要否を確定しない。docs/02 §13.3参照。

## Issue39の残作業

- 質問生成8秒/成功率・schema reject指標。固定質問fallbackと失敗を区別する。
- 配送pending15分、ジョブ失敗、削除期限超過の安全な集計metric/アラート。
- 権限拒否急増・無通信/外形監視、正式通知経路/当番、実適用と到達試験。
- 実運用データによる閾値再評価、必要なPRレビュー/マージ。

すべて完了するまで#39/#26はopenとする。

## 一次資料

- [固定provider 6.50.0: SLO](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v6.50.0/website/docs/r/monitoring_slo.html.markdown)
- [固定provider 6.50.0: log metric](https://raw.githubusercontent.com/hashicorp/terraform-provider-google/v6.50.0/website/docs/r/logging_metric.html.markdown)
- [SLOのbad/total型と制約](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/services.serviceLevelObjectives)
- [Log metricのvalueExtractor](https://docs.cloud.google.com/logging/docs/reference/v2/rest/v2/projects.metrics)
- [監視の料金](https://cloud.google.com/stackdriver/pricing)
