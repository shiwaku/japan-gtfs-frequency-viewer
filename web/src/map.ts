import maplibregl, {
  type StyleSpecification,
  type VectorSourceSpecification,
} from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { RoutesGeoJSON, StopsGeoJSON } from "./types";

// ---------------------------------------------------------------------------
// PMTiles プロトコル登録
// ---------------------------------------------------------------------------
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// ---------------------------------------------------------------------------
// ベースマップスタイル
// ---------------------------------------------------------------------------
// pale.json は web/public/ に配置（ビルド後は web/dist/ にコピーされる）
// import.meta.env.BASE_URL を使うことで GitHub Pages のサブパスにも対応
const PALE_STYLE_URL = `${import.meta.env.BASE_URL}pale.json`;
// pale.json が取得できない場合の fallback
const STD_STYLE_URL =
  "https://raw.githubusercontent.com/gsi-cyberjapan/optimal_bvmap/main/style/std.json";

/**
 * GSI 最適化ベクトルタイルのスタイルを取得する。
 * pale.json → std.json の順にフォールバック。
 * sources の tiles 配列に pmtiles:// が含まれる場合は url 形式に正規化する。
 */
async function loadBaseStyle(): Promise<StyleSpecification> {
  for (const url of [PALE_STYLE_URL, STD_STYLE_URL]) {
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const style = (await resp.json()) as StyleSpecification;
    return normalizePmtilesSources(style);
  }
  throw new Error("ベースマップスタイルの読み込みに失敗しました。");
}

/**
 * tiles 配列の pmtiles:// エントリを url プロパティ形式に正規化する。
 * （GSI std.json は tiles 配列形式だが、MapLibre の pmtiles プロトコルは url 形式を推奨）
 */
function normalizePmtilesSources(style: StyleSpecification): StyleSpecification {
  for (const source of Object.values(style.sources)) {
    if (source.type !== "vector") continue;
    const vSrc = source as VectorSourceSpecification;
    if (!vSrc.tiles) continue;
    const firstTile = vSrc.tiles[0];
    if (!firstTile.startsWith("pmtiles://")) continue;

    // "pmtiles://https://...file.pmtiles/{z}/{x}/{y}" → "pmtiles://https://...file.pmtiles"
    const pmtilesUrl = firstTile.replace(/\/\{z\}\/\{x\}\/\{y\}$/, "");
    (vSrc as Record<string, unknown>).url = pmtilesUrl;
    delete (vSrc as Record<string, unknown>).tiles;
  }
  return style;
}

// ---------------------------------------------------------------------------
// レイヤー ID 定数
// ---------------------------------------------------------------------------
export const LAYER = {
  ROUTES: "gtfs-routes",
  ROUTES_LABEL: "gtfs-routes-label",
  STOPS: "gtfs-stops",
  STOPS_LABEL: "gtfs-stops-label",
} as const;

const SOURCE = {
  ROUTES: "gtfs-routes-src",
  STOPS: "gtfs-stops-src",
} as const;

// ---------------------------------------------------------------------------
// マップ初期化
// ---------------------------------------------------------------------------
export async function initMap(container: string): Promise<maplibregl.Map> {
  const style = await loadBaseStyle();

  return new Promise((resolve, reject) => {
    const map = new maplibregl.Map({
      container,
      style,
      center: [136.0, 36.5],
      zoom: 5,
      maxZoom: 18,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

    // スタイルが完全にロードされてから resolve する
    map.on("load", () => resolve(map));
    map.on("error", (e) => reject(e.error));
  });
}

// ---------------------------------------------------------------------------
// GTFSレイヤー管理
// ---------------------------------------------------------------------------
export function addGtfsLayers(
  map: maplibregl.Map,
  routes: RoutesGeoJSON,
  stops: StopsGeoJSON
): void {
  removeGtfsLayers(map);

  // ソース追加
  map.addSource(SOURCE.ROUTES, { type: "geojson", data: routes });
  map.addSource(SOURCE.STOPS, { type: "geojson", data: stops });

  // ① 運行頻度路線
  map.addLayer({
    id: LAYER.ROUTES,
    type: "line",
    source: SOURCE.ROUTES,
    layout: {
      "line-cap": "round",
      "line-join": "round",
    },
    paint: {
      "line-color": "#00AF20",
      "line-width": ["get", "line_width"],
      "line-opacity": 0.85,
    },
  });

  // ② 頻度ラベル（路線中央）
  map.addLayer({
    id: LAYER.ROUTES_LABEL,
    type: "symbol",
    source: SOURCE.ROUTES,
    layout: {
      "symbol-placement": "line-center",
      "text-field": ["to-string", ["get", "frequency"]],
      "text-font": ["NotoSansJP-Regular"],
      "text-size": 10,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#1a1a1a",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });

  // ③ 停留所
  map.addLayer({
    id: LAYER.STOPS,
    type: "circle",
    source: SOURCE.STOPS,
    minzoom: 11,
    paint: {
      "circle-color": "#FF8000",
      "circle-radius": ["get", "circle_radius"],
      "circle-opacity": 0.7,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  });

  // ④ 停留所名ラベル
  map.addLayer({
    id: LAYER.STOPS_LABEL,
    type: "symbol",
    source: SOURCE.STOPS,
    minzoom: 12,
    layout: {
      "text-field": ["get", "similar_stop_name"],
      "text-font": ["NotoSansJP-Regular"],
      "text-size": 10,
      "text-offset": [0, 1.2],
      "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#303030",
      "text-halo-color": "#ffffff",
      "text-halo-width": 1.5,
    },
  });

  // ポップアップ（路線クリック）
  map.on("click", LAYER.ROUTES, (e) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties as Record<string, unknown>;
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(buildPopupHtml(props, ["line_width"]))
      .addTo(map);
  });

  // ポップアップ（停留所クリック）
  map.on("click", LAYER.STOPS, (e) => {
    if (!e.features?.length) return;
    const props = e.features[0].properties as Record<string, unknown>;
    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(buildPopupHtml(props, ["circle_radius"]))
      .addTo(map);
  });

  map.on("mouseenter", LAYER.ROUTES, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", LAYER.ROUTES, () => { map.getCanvas().style.cursor = ""; });
  map.on("mouseenter", LAYER.STOPS, () => { map.getCanvas().style.cursor = "pointer"; });
  map.on("mouseleave", LAYER.STOPS, () => { map.getCanvas().style.cursor = ""; });
}

export function removeGtfsLayers(map: maplibregl.Map): void {
  for (const id of Object.values(LAYER)) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of Object.values(SOURCE)) {
    if (map.getSource(id)) map.removeSource(id);
  }
}

export function setLayerVisibility(
  map: maplibregl.Map,
  layerId: string,
  visible: boolean
): void {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
  }
}

// ---------------------------------------------------------------------------
// 表示範囲をデータに合わせる
// ---------------------------------------------------------------------------
export function fitBoundsToRoutes(map: maplibregl.Map, routes: RoutesGeoJSON): void {
  const coords: [number, number][] = [];

  for (const f of routes.features) {
    const geom = f.geometry;
    if (geom.type === "LineString") {
      coords.push(...(geom.coordinates as [number, number][]));
    } else if (geom.type === "MultiLineString") {
      for (const line of geom.coordinates) {
        coords.push(...(line as [number, number][]));
      }
    }
  }

  if (coords.length === 0) return;

  const lngs = coords.map((c) => c[0]);
  const lats = coords.map((c) => c[1]);

  map.fitBounds(
    [
      [Math.min(...lngs), Math.min(...lats)],
      [Math.max(...lngs), Math.max(...lats)],
    ],
    { padding: 40, maxZoom: 14 }
  );
}

// ---------------------------------------------------------------------------
// ユーティリティ
// ---------------------------------------------------------------------------
function buildPopupHtml(
  props: Record<string, unknown>,
  excludeKeys: string[]
): string {
  const rows = Object.entries(props)
    .filter(([k]) => !excludeKeys.includes(k))
    .map(([k, v]) => `<tr><td class="pk">${k}</td><td>${v}</td></tr>`)
    .join("");
  return `<table class="popup-table">${rows}</table>`;
}
