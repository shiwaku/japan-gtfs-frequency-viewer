import "maplibre-gl/dist/maplibre-gl.css";
import "./style.css";

import { processGtfs } from "./api";
import {
  addGtfsLayers,
  fitBoundsToRoutes,
  initMap,
  LAYER,
  removeGtfsLayers,
  setLayerVisibility,
} from "./map";
import {
  clearStatus,
  collectParams,
  els,
  hideResults,
  initUi,
  setRunning,
  showResults,
  showStatus,
} from "./ui";
import type maplibregl from "maplibre-gl";

// ---------------------------------------------------------------------------
// 起動
// ---------------------------------------------------------------------------
let map: maplibregl.Map;

(async () => {
  initUi();

  map = await initMap("map");
  console.log("[GTFS] map loaded");

  // 実行ボタン
  els.runBtn.addEventListener("click", handleRun);

  // レイヤー表示切替
  bindToggle(els.toggleRoutes, LAYER.ROUTES);
  bindToggle(els.toggleRouteLabels, LAYER.ROUTES_LABEL);
  bindToggle(els.toggleStops, LAYER.STOPS);
  bindToggle(els.toggleStopLabels, LAYER.STOPS_LABEL);
})();

// ---------------------------------------------------------------------------
// 処理実行ハンドラ
// ---------------------------------------------------------------------------
async function handleRun(): Promise<void> {
  const params = collectParams();
  if (!params) return;

  setRunning(true);
  clearStatus();
  hideResults();
  removeGtfsLayers(map);
  showStatus("GTFSデータを処理中...", "info");

  try {
    const data = await processGtfs(params);
    console.log("[GTFS] routes:", data.routes.features.length, "stops:", data.stops.features.length);

    try {
      addGtfsLayers(map, data.routes, data.stops);
      console.log("[GTFS] layers added. map.loaded:", map.loaded(), "style loaded:", map.isStyleLoaded());
    } catch (layerErr) {
      const msg = layerErr instanceof Error ? layerErr.message : String(layerErr);
      console.error("[GTFS] addGtfsLayers failed:", msg);
      showStatus(`レイヤー追加エラー: ${msg}`, "error");
      return;
    }

    if (data.routes.features.length > 0) {
      fitBoundsToRoutes(map, data.routes);
    }

    showResults(data.meta);
    showStatus(
      `完了: ${data.meta.total_routes.toLocaleString()} 路線セグメント、${data.meta.total_stops.toLocaleString()} 停留所`,
      "success"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    showStatus(`エラー: ${message}`, "error");
  } finally {
    setRunning(false);
  }
}

// ---------------------------------------------------------------------------
// レイヤー表示切替バインド
// ---------------------------------------------------------------------------
function bindToggle(checkbox: HTMLInputElement, layerId: string): void {
  checkbox.addEventListener("change", () => {
    setLayerVisibility(map, layerId, checkbox.checked);
  });
}
