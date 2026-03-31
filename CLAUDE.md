# CLAUDE.md

## プロジェクト概要

GTFSデータから運行頻度図を生成し、MapLibre GL JS で表示するWebアプリ。
QGISプラグイン GTFS-GO（../GTFS-GO-main）のWeb版。
**ブラウザのみで動作（サーバー不要）。GitHub Pages でホスティング。**

## アーキテクチャ

```
ブラウザ (TypeScript + MapLibre GL JS)
    ↓ File / URL
gtfs_parser.ts（ブラウザ内でGTFS ZIP解析・頻度集計）
    ↓ GeoJSON
map.ts（MapLibre GL JS でレイヤー描画）
```

- **フロントエンド**: `web/src/` (TypeScript + Vite)
- **GTFSデータ処理**: `web/src/gtfs_parser.ts`（ブラウザ内 TypeScript、サーバー不要）
- `app.py` は旧バックエンド。ローカル実行の参考として残存。

## 開発コマンド

```bash
# フロントエンド開発サーバー
cd web && npm run dev   # → http://localhost:5173

# フロントエンドビルド
cd web && npm run build
```

## 重要な設計メモ

### GTFSパーサー（gtfs_parser.ts）

Python の `gtfs_parser.Aggregator` 相当の処理を TypeScript で再実装。
- JSZip で ZIP 展開 → CSV パース
- `calendar.txt` / `calendar_dates.txt` で日付フィルタ
- 時間帯フィルタは前停留所の出発時刻で判定
- `unify_stops=true` 時は同名停留所を重心でグループ化

### URL取得とCORS

URL入力時はまず直接 fetch を試み、CORS エラーの場合は `corsproxy.io` にフォールバック。
ただし対象サーバーがプロキシをブロックしている場合は 403 になる（解決不可）。
GitHub Pages（静的ホスティング）では URL 取得に制限あり。ファイルアップロード推奨。

### スタイル設定（map.ts）

- 路線: 緑 `#00AF20`、不透明度 0.85
- 停留所: オレンジ `#FF8000`、不透明度 0.7

### line_width / circle_radius の計算

`gtfs_parser.ts` 内で計算して GeoJSON プロパティに付与。
MapLibre 側は `["get", "line_width"]` / `["get", "circle_radius"]` で参照するだけ。

```typescript
line_width    = (0.05 + freq^0.6 * 0.2) * 6    // ×6 に調整済み
circle_radius = (0.8 + 0.2 * count^0.5) * 5
```

### frequency / count の意味

- `frequency`: フィルタ期間中にその区間を通過した便数（方向別。上り下りは別カウント）
- `count`: フィルタ期間中にその停留所に停車した延べ回数（全路線合計）

### ベースマップ（GSI 最適化ベクトルタイル）

`web/src/map.ts` の `loadBaseStyle()` で以下の順にフォールバック:
1. `{BASE_URL}pale.json` (淡色スタイル) - `web/public/pale.json` として配置
2. `std.json` (標準スタイル・fallback)

`import.meta.env.BASE_URL` を使用することで GitHub Pages のサブパスにも対応。

### GitHub Pages デプロイ

`.github/workflows/deploy.yml` で main push 時に自動ビルド＆デプロイ。
`VITE_BASE_PATH=/<リポジトリ名>/` を CI 環境変数として渡す。

### WSL2 でのファイル編集時の注意

`/mnt/c/` 上のファイルを編集した場合、Vite の HMR が効かない。
変更後は Vite dev server を再起動すること（`Ctrl+C` → `npm run dev`）。

### GTFSデータの日付フィルタ注意

GTFSデータの有効期間外の日付を指定すると `stop_times` が 0 件になり路線が表示されない。
停留所は表示される（全停留所が unify_stops 処理対象のため）。

## デプロイ

GitHub Actions が使用不可のため、手動デプロイ方式を採用。

```bash
cd web
VITE_BASE_PATH=/japan-gtfs-frequency-viewer/ npm run build
npx gh-pages -d dist --dotfiles
```

- `gh-pages` ブランチに push → GitHub Pages (Deploy from a branch) で公開
- `.nojekyll` を dist に含めることで Jekyll ビルドをスキップ
- 公開 URL: https://shiwaku.github.io/japan-gtfs-frequency-viewer/

## 依存関係

- TypeScript: `maplibre-gl@5.21.1`, `pmtiles@4.4.0`, `jszip`, `vite@^6`, `typescript@^5`
- デプロイ: `gh-pages`

## TODO / 検討中

- GTFSファイル選択時に有効期間（calendar.txt / calendar_dates.txt）を自動読み取りして表示・日付欄に自動セット
