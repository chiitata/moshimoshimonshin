# 患者アプリ

Flutter の Android / iOS / Web 向けデモ雛形です。現在は準備画面のみで、認証・問診・配送は未実装です。実患者データや実在施設の非公開情報は使用しないでください。

## ローカル起動

ルートの `make up` は Firebase Emulator と Flutter Web を起動します。Flutter SDK と稼働中の Docker が必要です。患者アプリだけを起動するには、エミュレータを別途起動した上で `make patient-start` を使ってください。起動の成否は `make logs-patient` と http://localhost:5050 で確認します。

この雛形は `USE_FIREBASE_EMULATOR=true` と `FIREBASE_PROJECT_ID=demo-mmr-dev` が明示された場合にのみ Firebase を初期化し、実環境への接続は未対応です。これらは Makefile のデフォルト設定に含まれます。Android エミュレータからは `10.0.2.2`、Web と iOS シミュレータからは `localhost` を使用します。実機では開発機の到達可能なホストを `--dart-define=FIREBASE_EMULATOR_HOST=<host>` で指定し、エミュレータのネットワーク公開に注意してください。Messaging はネイティブ SDK による外部への自動登録を避けるため、通知実装時まで依存を追加しません。

### ブラウザで画面を確認する

`nix develop` に入った後、リポジトリルートで `make up` を実行し、Firefox 等で http://localhost:5050 を開きます。Flutter の `web-server` を使うため、Flutter が Chrome を検出できなくてもブラウザから開けます。実データではなく合成データだけを使ってください。

現在の画面は準備中の雛形のみで、問診やログインの操作はできません。ブラウザの文字拡大やキーボード操作も確認できますが、Web の見え方は Android や iOS と同一とは限らず、実機やスクリーンリーダーによる確認の代替にはなりません。

Android Emulator での確認には別途 Android SDK、エミュレータとシステムイメージ、仮想化対応環境が必要です。iOS のエミュレータやビルドには macOS と Xcode が必要です。

## 検証

`apps/patient` で `flutter pub get`、`flutter analyze`、`flutter test` を実行します。iOS のビルドには macOS と Xcode が別途必要です。Android のビルドにも対応する SDK が必要です。

## 認証方式選択プレビュー

認証方式選択（P-003）の見た目を単独で確認できます。Flutter SDK を用意し、`apps/patient` で次を実行して http://localhost:5056 を開きます。確認後は Ctrl+C で停止します。このプレビューは認証・API に接続せず、選択操作は未接続です。実患者情報は入力しないでください。

```sh
flutter run -d web-server --web-hostname=localhost --web-port=5056 -t lib/demo_auth_method_preview.dart
```

Passkey は審査承認まで既定で非表示です。表示状態だけを確認する場合は、承認済みのレビュー環境に限り `--dart-define=PASSKEY_AUTH_ENABLED=true` を追加します。このフラグは公開承認を意味しません。
