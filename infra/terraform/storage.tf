# アプリ用 Storage バケット（処方箋画像等。サーバAPI経由のみアクセス、ADR-0008）
# Firebase の *.appspot.com は未作成のため、専用バケットを宣言的に作成する。
# var.storage_bucket が指定されていればそちらを正とし、このバケットは作らない。

resource "google_storage_bucket" "app" {
  count                       = var.storage_bucket == "" ? 1 : 0
  name                        = "${var.project_id}-app"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # 短命の署名URL運用（ADR-0008）。誤削除防止のため force_destroy は無効。
  force_destroy = false
}
