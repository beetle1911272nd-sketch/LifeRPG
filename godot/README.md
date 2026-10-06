# ABORE LIFE RPG - Prototype v0.1 (Godot 4.x)

3Dフィールドを歩き回り、スライムと戦い、EXPを得てレベルアップし、アイテムを拾い、セーブできる最小プロトタイプです。

## 起動方法
1. Godotを起動 → プロジェクトマネージャーで「インポート」
2. この `project.godot` を選んで「インポート&編集」
3. 右上の再生ボタン(▶)か F5 キーで実行

(初回は読み込みに少し時間がかかります。`scenes/main/title_screen.tscn` がタイトル画面です)

## 操作
WASD 移動 / マウス カメラ / SHIFT ダッシュ / SPACE ジャンプ / 左クリック 攻撃 / 右クリック 回避(短い無敵つき) /
Q ポーション使用 / TAB インベントリ / ESC メニュー(ステータス・セーブ・タイトルへ)

## セーブ
`user://abore_save.json`(Godotの「プロジェクト > ユーザーデータフォルダを開く」で場所が分かります)。
レベルアップ時・30秒ごと・メニューのSAVE・終了時に自動保存されます。

## はじまりの草原のビジュアル
- 地形の大きな起伏に細かな地形変化と色むらを重ね、単色の平面に見えないようにしています。
- 稜線ごとに形と色を変えた遠景の山、森のまとまり、花の群生、小さな低木を手続き生成します。
- スタート地点から遠景の城へ続く細い土の道を配置し、城の背後には視界の抜けを残しています。
- 空・雲・太陽光・大気遠近を調整し、モバイルWebで重いSSAO/Bloomは無効にしています。
- 植生・花・岩はMultiMeshで描画し、既存のプレイヤー操作・戦闘・セーブ構成は変更していません。
- 地形メッシュの高さを一度だけサンプリングして再利用し、生成時のノイズ計算を減らしています。

## 日本語フォント
- UIではSIL Open Font License 1.1のNoto Sans JPを使用します。
- `assets/fonts/NotoSansJP-UI.ttf` はゲーム内テキストで使う文字だけにサブセット化しています。ライセンス全文は `assets/fonts/OFL-NotoSansJP.txt` にあります。

## Web / PWA
- Godotの「Web」Export PresetはPWAを有効にしており、`index.html`、Web App Manifest、Service Worker、ABORE紋章の144/180/512pxアイコンを書き出します。
- Godot本体のブートスプラッシュもABOREの紋章に差し替え、Web読み込み中は既定のロゴを隠して紋章・タイトル・進捗バーを表示します。
- `../ABORE_LIFE_RPG-PWA/` に出力される一式をHTTPS対応のWebサーバーに配置すると、対応ブラウザーからホーム画面に追加できます。Service Workerがゲーム本体をキャッシュし、次回以降のオフライン起動に対応します。
- Service Workerは更新時に新バージョンへ即時切り替わり、古いキャッシュを削除して開いているアプリを再読み込みします。
- 再書き出し後は `python3 tools/prepare_pwa.py ../ABORE_LIFE_RPG-PWA/index.service.worker.js` を実行してください（生成物への更新設定を加えるツール自体はWebビルドに含めません）。

## フォルダと役割
- scripts/systems/ : GameManager(全体管理) / PlayerStats / LevelSystem / CombatSystem / InventorySystem / ItemData / SaveSystem
- scripts/player/  : PlayerController / PlayerVisual(見た目) / CameraRig
- scripts/enemies/ : EnemyBase / EnemyAI / Slime / CreatureEnemy
- scripts/world/   : GameWorld / TerrainBuilder / EnvironmentBuilder / CastleBuilder / ItemDrop / ShopMerchant
- scripts/ui/      : UiManager / Hud / StatusPanel / InventoryPanel / ShopPanel / LevelUpOverlay / TitleScreen / UiStyle

## 敵と旅人の露店
- スライムに加えて、アニメーション付きのコウモリとイノシシが草原に出現し、撃破後は同じ場所に再出現します。
- スタート地点の近くに旅人の露店を追加しました。範囲内で E キーを押すと開き、ポーション購入とスライムコア売却ができます。
- 購入・売却は所持金と所持数を検証してから反映し、従来のインベントリ保存データに保存します。
- 環境の色調を青紫の夕暮れと暖かな地平線に寄せ、遠景の見通しとゲームプレイ時の明るさは維持しています。
- 使用モデルは軽量な抜粋のみを含め、出典とライセンスは `ASSET_SOURCES.md` に記載しています。

## 将来の拡張ポイント
- Supabase同期: PlayerStats.to_dict()/from_dict() と SaveSystem を、クラウド版に差し替えるだけ
- 3Dキャラ差し替え: PlayerController._build_visual() を書き換える
- 新しい敵: EnemyBase を継承して _setup_data() / _build_model() を書く(slime.gd が見本)
- 新しいアイテム: ItemData.ITEMS に1行追加
