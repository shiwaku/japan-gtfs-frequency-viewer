"""
GTFS 運行頻度図 Web アプリ - FastAPI バックエンド

【開発時】
  ターミナル1: cd japan-gtfs-frequency-viewer && uvicorn app:app --reload --port 8000
  ターミナル2: cd japan-gtfs-frequency-viewer/web && npm run dev
  → ブラウザで http://localhost:5173

【本番ビルド後】
  cd japan-gtfs-frequency-viewer/web && npm run build
  cd .. && uvicorn app:app --port 8000
  → ブラウザで http://localhost:8000
"""

import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional

import requests
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

# GTFS-GO-main の gtfs_parser サブモジュールをパスに追加
GTFS_GO_DIR = Path(__file__).parent.parent / "GTFS-GO-main"
sys.path.insert(0, str(GTFS_GO_DIR))

# gtfs_parser のインポート（PyPI パッケージ優先、サブモジュールにフォールバック）
HAS_GTFS_PARSER = False
GTFSFactory = None
Aggregator = None

try:
    from gtfs_parser import gtfs_parser as _gp

    GTFSFactory = _gp.GTFSFactory
    Aggregator = _gp.aggregate.Aggregator
    HAS_GTFS_PARSER = True
except ImportError:
    try:
        import gtfs_parser as _gp

        GTFSFactory = _gp.GTFSFactory
        Aggregator = _gp.aggregate.Aggregator
        HAS_GTFS_PARSER = True
    except (ImportError, AttributeError):
        pass

app = FastAPI(title="GTFS 運行頻度図 Web")

DIST_DIR = Path(__file__).parent / "web" / "dist"


@app.get("/status")
async def status():
    return {
        "gtfs_parser_available": HAS_GTFS_PARSER,
        "gtfs_go_dir": str(GTFS_GO_DIR),
        "message": (
            "正常に動作しています"
            if HAS_GTFS_PARSER
            else "gtfs_parser が見つかりません。`pip install gtfs-parser` を実行してください。"
        ),
    }


@app.post("/process")
async def process(
    gtfs_url: Optional[str] = Form(None),
    gtfs_file: Optional[UploadFile] = File(None),
    yyyymmdd: str = Form(""),
    begin_time: str = Form(""),
    end_time: str = Form(""),
    unify_stops: bool = Form(True),
    delimiter: str = Form(""),
):
    if not HAS_GTFS_PARSER:
        raise HTTPException(
            status_code=500,
            detail="gtfs_parser が見つかりません。`pip install gtfs-parser` を実行してください。",
        )

    if not gtfs_file and not gtfs_url:
        raise HTTPException(
            status_code=400,
            detail="gtfs_file または gtfs_url のいずれかが必要です。",
        )

    tmp_dir = Path(tempfile.mkdtemp())
    try:
        zip_path = tmp_dir / "gtfs.zip"

        if gtfs_file:
            zip_path.write_bytes(await gtfs_file.read())
        else:
            try:
                resp = requests.get(gtfs_url, timeout=60)
                resp.raise_for_status()
                zip_path.write_bytes(resp.content)
            except requests.RequestException as e:
                raise HTTPException(
                    status_code=400,
                    detail=f"GTFSデータのダウンロードに失敗しました: {e}",
                )

        gtfs = GTFSFactory(str(zip_path))

        aggregator = Aggregator(
            gtfs,
            no_unify_stops=not unify_stops,
            delimiter=delimiter,
            yyyymmdd=yyyymmdd,
            begin_time=begin_time.replace(":", ""),
            end_time=end_time.replace(":", ""),
        )

        route_features = aggregator.read_route_frequency()
        stop_features = aggregator.read_interpolated_stops()

        # MapLibre 用スタイル値を計算（QGIS QML 式をピクセル換算）
        for feature in route_features:
            freq = max(feature["properties"].get("frequency", 0), 0)
            feature["properties"]["line_width"] = round((0.05 + (freq**0.6) * 0.2) * 4, 2)

        for feature in stop_features:
            count = max(feature["properties"].get("count", 1), 0)
            feature["properties"]["circle_radius"] = round((0.8 + 0.2 * (count**0.5)) * 5, 2)

        return JSONResponse(
            {
                "routes": {"type": "FeatureCollection", "features": route_features},
                "stops": {"type": "FeatureCollection", "features": stop_features},
                "meta": {
                    "total_routes": len(route_features),
                    "total_stops": len(stop_features),
                    "date": yyyymmdd,
                    "begin_time": begin_time,
                    "end_time": end_time,
                },
            }
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"処理中にエラーが発生しました: {e}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# フロントエンド配信（API ルートの後に定義することで優先度を下げる）
# ---------------------------------------------------------------------------
if DIST_DIR.exists():
    # 本番: web/dist/ 全体をルートにマウント（pale.json 等も含む）
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="frontend")
else:
    # 開発時: Vite dev server (port 5173) が担うため何もしない
    @app.get("/", include_in_schema=False)
    async def root():
        return FileResponse(Path(__file__).parent / "web" / "index.html")
