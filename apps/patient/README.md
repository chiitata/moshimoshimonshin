# 患者アプリ

Flutter の Android / iOS / Web 向けデモ雛形です。現在は準備画面のみで、認証・問診・配送は未実装です。実患者データや実在施設の非公開情報は使用しないでください。

## ローカル起動

ルートの `make up` は Firebase Emulator と Flutter Web を起動します。Flutter SDK と稼働中の Docker が必要です。患者アプリだけを起動するには、エミュレータを別途起動した上で `make patient-start` を使ってください。起動の成否は `make logs-patient` と http://localhost:5050 で確認します。

この雛形は `USE_FIREBASE_EMULATOR=true` と `FIREBASE_PROJECT_ID=demo-mmr-dev` が明示された場合にのみ Firebase を初期化し、実環境への接続は未対応です。これらは Makefile のデフォルト設定に含まれます。Firebase には単一のホストガードが入っており、許可されるのは `localhost` と `127.0.0.1`、そして Android 非 Web ビルドだけが `10.0.2.2` のみです。比較は完全一致・大文字小文字区別で、`localhost:9099` のようなポート付きや `localhost.evil.example` のような類似値は拒否され、Firebase を初期化する前に `StateError` になります。`--dart-define=FIREBASE_EMULATOR_HOST=<host>` で上書きする場合もこの範囲で、範囲外のホストを指定すると起動時に失敗します。デフォルトは Android エミュレータが `10.0.2.2`、それ以外（Web / iOS シミュレータ）が `localhost` です。つまり Android エミュレータからは `10.0.2.2`、Web と iOS シミュレータからは `localhost` を使い、物理端末（実機）から開発機の LAN IP など任意の LAN ホストで接続する構成は未対応です。エミュレータを外部ネットワークに公開することも想定していません。Messaging はネイティブ SDK による外部への自動登録を避けるため、通知実装時まで依存を追加しません。

### ブラウザで画面を確認する

`nix develop` に入った後、リポジトリルートで `make up` を実行し、Firefox 等で http://localhost:5050 を開きます。Flutter の `web-server` を使うため、Flutter が Chrome を検出できなくてもブラウザから開けます。実データではなく合成データだけを使ってください。

現在の画面は準備中の雛形のみで、問診やログインの操作はできません。ブラウザの文字拡大やキーボード操作も確認できますが、Web の見え方は Android や iOS と同一とは限らず、実機やスクリーンリーダーによる確認の代替にはなりません。

Android Emulator での確認には別途 Android SDK、エミュレータとシステムイメージ、仮想化対応環境が必要です。iOS のエミュレータやビルドには macOS と Xcode が必要です。

## 検証

`apps/patient` で `flutter pub get`、`flutter analyze`、`flutter test` を実行します。iOS のビルドには macOS と Xcode が別途必要です。Android のビルドにも対応する SDK が必要です。
