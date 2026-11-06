# 医療機関ポータル（デモ）

合成データのみの画面雛形です。認証・認可、受信・閲覧、監査などは未実装であり、実運用や実データの入力は禁止です。画面は API や Firebase に接続しません。

Node.js 22 以降で `npm ci`、`npm run dev` を実行し、http://localhost:3000 を開きます。`npm run lint`、`npm test`、`npm run build` で検証できます。Docker Compose では既存の hospital サービスを使用します。

`lib/firebase-demo.ts` は将来のデモ向けの明示的な初期化関数です。`NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-mmr-dev`、`NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` と Compose が指定する localhost の Auth / Firestore / Storage エミュレータのアドレスがすべて必要で、異なる設定は拒否します。SDK は画面から呼び出されません。ブラウザとエミュレータが同じホストにある構成のみ対応します。

本番 Hosting 静的配信か SSR かは未決定です。実用化にはインフラとの調整と、認証・施設単位の認可・監査・医療情報保護の実装と検証が必要です。
