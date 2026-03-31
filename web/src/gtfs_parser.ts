/**
 * ブラウザ内 GTFS パーサー
 * Python の gtfs_parser.Aggregator 相当の処理を TypeScript で実装。
 */

import JSZip from "jszip";
import type { Feature, FeatureCollection, LineString, Point } from "geojson";
import type { ProcessResponse, RouteProperties, StopProperties } from "./types";

// ---------------------------------------------------------------------------
// CSV パース
// ---------------------------------------------------------------------------

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const nonEmpty = lines.filter((l) => l.trim() !== "");
  if (nonEmpty.length < 2) return [];
  const headers = parseCsvLine(nonEmpty[0]).map((h) => h.trim());
  return nonEmpty.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? "").trim();
    });
    return row;
  });
}

// ---------------------------------------------------------------------------
// URL フェッチ（CORS プロキシフォールバック付き）
// ---------------------------------------------------------------------------

const CORS_PROXY = "https://corsproxy.io/?";

async function fetchWithCorsProxy(url: string): Promise<ArrayBuffer> {
  // まず直接取得を試みる
  try {
    const resp = await fetch(url);
    if (resp.ok) return resp.arrayBuffer();
  } catch {
    // CORS エラー等 → プロキシへフォールバック
  }

  // CORS プロキシ経由で再試行
  const proxyUrl = CORS_PROXY + encodeURIComponent(url);
  let resp: Response;
  try {
    resp = await fetch(proxyUrl);
  } catch (e) {
    throw new Error(`GTFSデータの取得に失敗しました（直接・プロキシ両方）: ${e}`);
  }
  if (!resp.ok) {
    throw new Error(`GTFSデータのダウンロードに失敗しました: ${resp.status} ${resp.statusText}`);
  }
  return resp.arrayBuffer();
}

// ---------------------------------------------------------------------------
// ZIP 読み込み
// ---------------------------------------------------------------------------

async function loadGtfsZip(source: File | string): Promise<Map<string, string>> {
  let arrayBuffer: ArrayBuffer;
  if (source instanceof File) {
    arrayBuffer = await source.arrayBuffer();
  } else {
    arrayBuffer = await fetchWithCorsProxy(source);
  }

  const zip = await JSZip.loadAsync(arrayBuffer);
  const files = new Map<string, string>();
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const basename = path.split("/").pop()!;
    if (!basename.endsWith(".txt")) continue;
    const content = await entry.async("string");
    files.set(basename, content);
  }
  return files;
}

// ---------------------------------------------------------------------------
// 時刻ヘルパー
// ---------------------------------------------------------------------------

/** "HH:MM:SS" または "H:MM:SS" → 秒数（GTFS は 25:xx:xx 等もあり得る） */
function timeToSeconds(time: string): number {
  if (!time) return -1;
  const parts = time.split(":");
  const h = parseInt(parts[0] ?? "0", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  const s = parseInt(parts[2] ?? "0", 10);
  if (isNaN(h) || isNaN(m) || isNaN(s)) return -1;
  return h * 3600 + m * 60 + s;
}

/** "HH:MM" または "HHMM" → 秒数 */
function filterTimeToSeconds(hhmm: string): number {
  if (!hhmm) return -1;
  let h: number, m: number;
  if (hhmm.includes(":")) {
    const parts = hhmm.split(":");
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  } else {
    h = parseInt(hhmm.slice(0, 2), 10);
    m = parseInt(hhmm.slice(2, 4), 10);
  }
  if (isNaN(h) || isNaN(m)) return -1;
  return h * 3600 + m * 60;
}

// ---------------------------------------------------------------------------
// アクティブ service_id の取得
// ---------------------------------------------------------------------------

function getActiveServiceIds(
  yyyymmdd: string,
  calendar: Record<string, string>[],
  calendarDates: Record<string, string>[]
): Set<string> {
  const year = parseInt(yyyymmdd.slice(0, 4), 10);
  const month = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const day = parseInt(yyyymmdd.slice(6, 8), 10);
  const date = new Date(year, month, day);
  const dayNames = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const dayName = dayNames[date.getDay()];

  const active = new Set<string>();

  for (const cal of calendar) {
    if (yyyymmdd >= cal.start_date && yyyymmdd <= cal.end_date && cal[dayName] === "1") {
      active.add(cal.service_id);
    }
  }

  for (const cd of calendarDates) {
    if (cd.date === yyyymmdd) {
      if (cd.exception_type === "1") active.add(cd.service_id);
      else if (cd.exception_type === "2") active.delete(cd.service_id);
    }
  }

  return active;
}

// ---------------------------------------------------------------------------
// 停留所統合（unify_stops）
// ---------------------------------------------------------------------------

interface SimilarStop {
  similar_stop_id: string;
  similar_stop_name: string;
  lat: number;
  lon: number;
}

function buildStopUnification(
  stops: Record<string, string>[],
  delimiter: string
): Map<string, SimilarStop> {
  // 名前でグループ化
  const groups = new Map<string, Record<string, string>[]>();
  for (const stop of stops) {
    const name = delimiter ? stop.stop_name.split(delimiter)[0] : stop.stop_name;
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name)!.push(stop);
  }

  const result = new Map<string, SimilarStop>();
  for (const [name, group] of groups) {
    // グループの重心を代表座標とする
    const lat = group.reduce((s, st) => s + parseFloat(st.stop_lat), 0) / group.length;
    const lon = group.reduce((s, st) => s + parseFloat(st.stop_lon), 0) / group.length;
    const representativeId = group[0].stop_id;
    for (const stop of group) {
      result.set(stop.stop_id, { similar_stop_id: representativeId, similar_stop_name: name, lat, lon });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// メイン集計処理
// ---------------------------------------------------------------------------

export interface AggregatorOptions {
  yyyymmdd?: string;
  beginTime?: string;
  endTime?: string;
  unifyStops?: boolean;
  delimiter?: string;
}

export async function aggregateGtfs(
  source: File | string,
  options: AggregatorOptions
): Promise<ProcessResponse> {
  const { yyyymmdd = "", beginTime = "", endTime = "", unifyStops = true, delimiter = "" } = options;

  const files = await loadGtfsZip(source);

  const stopsRaw = parseCsv(files.get("stops.txt") ?? "");
  const routesRaw = parseCsv(files.get("routes.txt") ?? "");
  const tripsRaw = parseCsv(files.get("trips.txt") ?? "");
  const stopTimesRaw = parseCsv(files.get("stop_times.txt") ?? "");
  const calendarRaw = parseCsv(files.get("calendar.txt") ?? "");
  const calendarDatesRaw = parseCsv(files.get("calendar_dates.txt") ?? "");
  const agencyRaw = parseCsv(files.get("agency.txt") ?? "");

  // ---- ルック アップマップ構築 ----

  const routesMap = new Map<string, { route_id: string; agency_id: string; route_name: string }>();
  for (const r of routesRaw) {
    routesMap.set(r.route_id, {
      route_id: r.route_id,
      agency_id: r.agency_id ?? "",
      route_name: r.route_long_name || r.route_short_name || r.route_id,
    });
  }

  const agencyMap = new Map<string, string>();
  for (const a of agencyRaw) {
    agencyMap.set(a.agency_id ?? "", a.agency_name ?? "");
  }
  // agency_id なし（単一事業者）の場合は空文字キーでも引けるようにする
  if (agencyRaw.length === 1 && !agencyRaw[0].agency_id) {
    agencyMap.set("", agencyRaw[0].agency_name ?? "");
  }

  const tripsMap = new Map<string, { route_id: string; service_id: string }>();
  for (const r of tripsRaw) {
    tripsMap.set(r.trip_id, { route_id: r.route_id, service_id: r.service_id });
  }

  // ---- アクティブ service_id ----

  const activeServiceIds: Set<string> = yyyymmdd
    ? getActiveServiceIds(yyyymmdd, calendarRaw, calendarDatesRaw)
    : new Set(tripsRaw.map((r) => r.service_id));

  // ---- 停留所統合マップ ----

  const stopToSimilar: Map<string, SimilarStop> = unifyStops
    ? buildStopUnification(stopsRaw, delimiter)
    : new Map(
        stopsRaw.map((s) => [
          s.stop_id,
          {
            similar_stop_id: s.stop_id,
            similar_stop_name: s.stop_name,
            lat: parseFloat(s.stop_lat),
            lon: parseFloat(s.stop_lon),
          },
        ])
      );

  // similar_stop_id → SimilarStop（代表情報）
  const similarStopsIndex = new Map<string, SimilarStop>();
  for (const ss of stopToSimilar.values()) {
    if (!similarStopsIndex.has(ss.similar_stop_id)) {
      similarStopsIndex.set(ss.similar_stop_id, ss);
    }
  }

  // ---- trip ごとの stop_times を構築 ----

  interface StopTimeRow { stop_id: string; stop_sequence: number; departure_time: string; }
  const tripStopTimes = new Map<string, StopTimeRow[]>();
  for (const r of stopTimesRaw) {
    if (!tripStopTimes.has(r.trip_id)) tripStopTimes.set(r.trip_id, []);
    tripStopTimes.get(r.trip_id)!.push({
      stop_id: r.stop_id,
      stop_sequence: parseInt(r.stop_sequence, 10),
      departure_time: r.departure_time || r.arrival_time,
    });
  }
  for (const times of tripStopTimes.values()) {
    times.sort((a, b) => a.stop_sequence - b.stop_sequence);
  }

  // ---- 時間帯フィルタ設定 ----

  const beginSec = filterTimeToSeconds(beginTime);
  const endSec = filterTimeToSeconds(endTime);
  const useTimeFilter = beginSec >= 0 && endSec >= 0;

  // ---- 頻度集計（区間ごと） ----

  const segments = new Map<
    string,
    { frequency: number; prev_similar_id: string; next_similar_id: string; route_id: string }
  >();

  // ---- 停留所カウント ----

  const stopCounts = new Map<string, number>();

  for (const [trip_id, trip] of tripsMap) {
    if (!activeServiceIds.has(trip.service_id)) continue;

    const stopTimes = tripStopTimes.get(trip_id);
    if (!stopTimes || stopTimes.length < 1) continue;

    // 停留所カウント（時間帯フィルタ適用）
    for (const st of stopTimes) {
      if (useTimeFilter) {
        const depSec = timeToSeconds(st.departure_time);
        if (depSec < 0 || depSec < beginSec || depSec > endSec) continue;
      }
      const similar = stopToSimilar.get(st.stop_id);
      if (!similar) continue;
      stopCounts.set(similar.similar_stop_id, (stopCounts.get(similar.similar_stop_id) ?? 0) + 1);
    }

    // 区間頻度カウント（時間帯フィルタは前停留所の出発時刻で判定）
    for (let i = 0; i < stopTimes.length - 1; i++) {
      const prev = stopTimes[i];
      const next = stopTimes[i + 1];

      if (useTimeFilter) {
        const depSec = timeToSeconds(prev.departure_time);
        if (depSec < 0 || depSec < beginSec || depSec > endSec) continue;
      }

      const prevSimilar = stopToSimilar.get(prev.stop_id);
      const nextSimilar = stopToSimilar.get(next.stop_id);
      if (!prevSimilar || !nextSimilar) continue;
      // 統合後に同一停留所になる場合はスキップ
      if (prevSimilar.similar_stop_id === nextSimilar.similar_stop_id) continue;

      const key = `${prevSimilar.similar_stop_id}|${nextSimilar.similar_stop_id}|${trip.route_id}`;
      const existing = segments.get(key);
      if (existing) {
        existing.frequency++;
      } else {
        segments.set(key, {
          frequency: 1,
          prev_similar_id: prevSimilar.similar_stop_id,
          next_similar_id: nextSimilar.similar_stop_id,
          route_id: trip.route_id,
        });
      }
    }
  }

  // ---- route GeoJSON 生成 ----

  const routeFeatures: Feature<LineString, RouteProperties>[] = [];
  for (const seg of segments.values()) {
    const prevSimilar = similarStopsIndex.get(seg.prev_similar_id);
    const nextSimilar = similarStopsIndex.get(seg.next_similar_id);
    if (!prevSimilar || !nextSimilar) continue;

    const route = routesMap.get(seg.route_id);
    const agencyId = route?.agency_id ?? "";
    const agencyName = agencyMap.get(agencyId) ?? agencyMap.get("") ?? "";

    const freq = seg.frequency;
    const line_width = Math.round((0.05 + Math.pow(freq, 0.6) * 0.2) * 6 * 100) / 100;

    routeFeatures.push({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [prevSimilar.lon, prevSimilar.lat],
          [nextSimilar.lon, nextSimilar.lat],
        ],
      },
      properties: {
        frequency: freq,
        prev_stop_id: seg.prev_similar_id,
        prev_stop_name: prevSimilar.similar_stop_name,
        next_stop_id: seg.next_similar_id,
        next_stop_name: nextSimilar.similar_stop_name,
        agency_id: agencyId,
        agency_name: agencyName,
        route_id: seg.route_id,
        route_name: route?.route_name ?? "",
        line_width,
      },
    });
  }

  // ---- stop GeoJSON 生成 ----

  const stopFeatures: Feature<Point, StopProperties>[] = [];
  for (const [similarId, ss] of similarStopsIndex) {
    const count = stopCounts.get(similarId) ?? 0;
    if (count === 0) continue;

    const circle_radius = Math.round((0.8 + 0.2 * Math.sqrt(count)) * 5 * 100) / 100;
    stopFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [ss.lon, ss.lat] },
      properties: {
        similar_stop_name: ss.similar_stop_name,
        similar_stop_id: ss.similar_stop_id,
        count,
        circle_radius,
      },
    });
  }

  return {
    routes: { type: "FeatureCollection", features: routeFeatures },
    stops: { type: "FeatureCollection", features: stopFeatures },
    meta: {
      total_routes: routeFeatures.length,
      total_stops: stopFeatures.length,
      date: yyyymmdd,
      begin_time: beginTime,
      end_time: endTime,
    },
  };
}
