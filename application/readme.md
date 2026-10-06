# REAL LIFE RPG 引き継ぎメモ

## 次のAIへ

このフォルダは、REAL LIFE RPGをiPhoneでアプリとして運用するための作業環境です。最初の現実的な目標は、Safariからホーム画面に追加できるPWAとして公開することです。App Store向けのネイティブ化は、PWAで不足する要件が明確になった後に検討してください。

## 現在の配置

- `app.generated.jsx`: 現在のサンドボックスが読み込む主なReactアプリ本体
- `app.jsx`: 別バージョンのアプリソース。スマートクォートが混在しているため、現状は直接使わない
- `sandbox/main.jsx`: `../app.generated.jsx`を読み込むエントリポイント
- `sandbox/index.html`: ViteのHTMLエントリポイント
- `sandbox/vite.config.js`: Vite設定。親ディレクトリのファイルを読み込めるよう設定済み
- `sandbox/package.json`: React 18、Vite 5の依存関係と`dev`/`build`/`preview`スクリプト
- `gemini-code-1788870264732.py`: 付属スクリプト。用途と安全性を確認してから実行する
- `.copilot/task.md`: iPhone運用に向けた詳細タスク

## 起動方法（macOS）

```bash
cd "/Users/esya/Desktop/LIFE RPG/sandbox"
npm install
npm run dev -- --host 127.0.0.1
```

ブラウザで`http://127.0.0.1:5173/`を開く。開発サーバーを止めるときは、実行中のターミナルで`Ctrl+C`を押す。

## ビルド確認

```bash
cd "/Users/esya/Desktop/LIFE RPG/sandbox"
npm run build
```

まずこのビルドを成功させてから、PWA対応と公開設定へ進むこと。

## 直近で行う作業

1. `npm run build`で現在の構成を確認する。
2. アプリ本体を`app.generated.jsx`と`app.jsx`のどちらに統一するか決める。
3. iPhone縦画面でレスポンシブUI、Safe Area、タップ操作を確認する。
4. `manifest.webmanifest`、アプリアイコン、Service Workerを追加する。
5. `localStorage`のJSONエクスポート・インポートを追加する。
6. Supabaseの匿名ユーザーをPROFILEからApple / Googleアカウントへ連携できるようにする。Supabase側で各OAuth Providerと本番・PreviewのRedirect URLを設定する。
6. HTTPSホスティングへデプロイし、iPhone Safariの「ホーム画面に追加」で実機確認する。

## 既知の注意点

- 最初のZIPには`app.generated.jsx`がなく、`main.jsx`のimportエラーが発生した。追加ZIPからファイルを配置済み。
- ZIP内の`node_modules`はWindows等の別環境由来の可能性があるため、macOSでは削除して`npm install`し直す。
- `sandbox`の起動用スクリプトは`.cmd`とPowerShell向けで、macOSではそのまま実行せず、上記のnpmコマンドを使う。
- 現在の保存先はブラウザの`localStorage`。端末変更・Safariデータ削除への耐性はない。
- PROFILE > ACCOUNT / DATAから、保存データをJSONとして書き出し・復元できる。端末変更やSafariのデータ削除前にバックアップする。
- 保存データには`schemaVersion`が付与され、旧形式は起動時・復元時に移行される。
- `supabase/schema.sql`適用後は、認証済みユーザーのゲーム進行を`game_states`へ同期できる。匿名ユーザーの端末内データは、Apple / Google連携後に同じSupabaseユーザーへ引き継ぐ。
- Godot版との連携には、更新した`supabase/schema.sql`をSupabase SQL Editorへ適用する。PROFILE > ACCOUNT / DATAで発行した10分有効・一回限りのペアリングJSONをGodot版SETTINGSに貼り付けると、LEVEL / EXP / 所持装備 / 装備中スロットを共有する。Godot版では装備のATK / DEF / 最大HP補正も反映し、装備以外のゲーム内状態は同期せず、通常のローカルセーブも維持する。
- `life_rpg_weekly_ranking` / `life_rpg_monthly_ranking`は、公開プロフィールのユーザーだけを対象に`action_events`から期間EXPを集計する。
- オフライン中のACTION共有イベントは端末内の送信キューに最大100件保持し、オンライン復帰時に再送する。ゲーム本体の進行保存は従来どおり即時localStorage保存される。
- ACTIONイベントにはクライアント生成IDを付け、再送時の二重計上を防ぐ。
- ACTION履歴は`actionLog`へ構造化保存し、TARGET、UNIT、推定時間、実績値、実測時間、難易度、JOB補正、獲得EXP、STATS効果、達成時刻を将来の難易度調整・AIコーチ分析に利用できる。Supabase適用済み環境では`action_events`にも同じ達成メトリクスを保存する。
- 正式アカウントではACCOUNT / DATAから`DELETE`確認付きの退会処理を実行できる。`delete_my_account`関数はSupabase SQL適用後に有効になる。
- iPhoneのホーム画面アプリとして本番運用するには、localhostではなくHTTPSで公開する必要がある。
- iOSの本物のホーム画面WidgetKitウィジェットは、PWA単体ではAppleの制約により作成できない。`/?widget=small|medium|large`で同じデータを表示するPWA Widget画面を提供し、将来のネイティブ化時にWidgetKitへ移行できる形にしている。
- Vercelの`vercel.json`ではService Workerとmanifestに再検証ヘッダーを付け、PWA更新がCDNキャッシュで遅延しないようにしている。

## 実装上の確認ポイント

- アプリ本体の保存キーは`reallife_rpg_save_v1`。
- ステータスは`STR`、`INT`、`AGI`、`VIT`、`DEX`、`CHA`、`FIN`、`WILL`。
- 行動記録、経験値、レベル、クエスト、連続日数が主な状態。
- データモデルを変更する場合は保存データの後方互換性とマイグレーションを考慮する。
