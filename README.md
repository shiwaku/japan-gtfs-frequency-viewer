# japan-gtfs-frequency-viewer

GTFSデータから運行頻度図を生成し、Web地図（MapLibre GL JS）で表示するアプリケーション。

**ブラウザのみで動作します。サーバー不要。**

## デモ

https://&lt;ユーザー名&gt;.github.io/japan-gtfs-frequency-viewer/

## 技術スタック

| 役割 | 技術 |
|---|---|
| GTFSデータ処理 | TypeScript（ブラウザ内処理） |
| フロントエンド | TypeScript / Vite |
| 地図描画 | [MapLibre GL JS](https://maplibre.org/) v5 |
| ベースマップ | [国土地理院 最適化ベクトルタイル](https://github.com/gsi-cyberjapan/optimal_bvmap)（PMTiles） |
| ホスティング | GitHub Pages |

## 前提条件

- Node.js 18+

## セットアップ

```bash
cd web
npm install
```

## 起動方法

### 開発環境

```bash
cd web
npm run dev
```

ブラウザで http://localhost:5173 を開く。

### 本番ビルド

```bash
cd web
npm run build
```

`web/dist/` に静的ファイルが生成されます。

## 使い方

1. 「GTFSデータ」セクションでZIPファイルをアップロード（またはURLを入力）
2. 必要に応じてフィルタ（日付・時間帯）を設定
3. 「処理実行」ボタンをクリック
4. 地図に運行頻度図が表示される

> **注意**: URLからの取得はサーバーのCORS設定によっては動作しない場合があります。その場合はファイルをダウンロードしてアップロードしてください。

## 運行頻度の表示方法

| 要素 | 色 | 計算式 |
|---|---|---|
| 路線の線幅 | 緑 `#00AF20` | `(0.05 + frequency^0.6 × 0.2) × 6` px |
| 停留所の円半径 | オレンジ `#FF8000` | `(0.8 + 0.2 × count^0.5) × 5` px |

- `frequency`: フィルタ期間中にその区間を通過した便数（方向別）
- `count`: フィルタ期間中にその停留所に停車した延べ回数

QGIS プラグイン [GTFS-GO](https://github.com/MIERUNE/GTFS-GO) の QML スタイルと同じ式をベースにしています。

## 注意事項

- **日付フィルタ**: GTFSデータの有効期間外の日付を指定すると路線が表示されません。`calendar.txt` の `start_date` / `end_date` を確認してください。

## ベースマップについて

[国土地理院 最適化ベクトルタイル](https://github.com/gsi-cyberjapan/optimal_bvmap) の淡色地図（`pale.json`）を使用。PMTiles 形式でホストされているため、タイルサーバーへのリクエスト数を削減できます。

- PMTiles ファイル: https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/optimal_bvmap-v1.pmtiles
- pale.json が未取得の場合は std.json にフォールバック

## ディレクトリ構成

```
japan-gtfs-frequency-viewer/
├── .github/workflows/
│   └── deploy.yml       # GitHub Pages 自動デプロイ
├── web/                 # Vite フロントエンド
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.ts          # エントリポイント
│       ├── map.ts           # MapLibre GL JS 管理
│       ├── ui.ts            # UI イベント処理
│       ├── api.ts           # GTFSパーサー呼び出し
│       ├── gtfs_parser.ts   # GTFSデータ解析（ブラウザ内処理）
│       ├── types.ts         # TypeScript 型定義
│       └── style.css
└── app.py               # FastAPI バックエンド（ローカル実行用・参考）
```

## GitHub Pages へのデプロイ

1. このリポジトリを GitHub に push
2. Settings → Pages → Source を **GitHub Actions** に設定
3. main ブランチへの push で自動デプロイ

## 関連プロジェクト

- [GTFS-GO](https://github.com/MIERUNE/GTFS-GO) - QGISプラグイン版（同じ処理ロジック）
