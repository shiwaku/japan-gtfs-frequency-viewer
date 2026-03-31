import type { FeatureCollection, LineString, MultiLineString, Point } from "geojson";

export interface RouteProperties {
  frequency: number;
  prev_stop_id: string;
  prev_stop_name: string;
  next_stop_id: string;
  next_stop_name: string;
  agency_id?: string;
  agency_name?: string;
  route_id?: string;
  route_name?: string;
  /** Python バックエンドで計算済みの MapLibre 用線幅（px） */
  line_width: number;
}

export interface StopProperties {
  similar_stop_name: string;
  similar_stop_id: string;
  count: number;
  /** Python バックエンドで計算済みの MapLibre 用円半径（px） */
  circle_radius: number;
}

export type RoutesGeoJSON = FeatureCollection<LineString | MultiLineString, RouteProperties>;
export type StopsGeoJSON = FeatureCollection<Point, StopProperties>;

export interface ProcessMeta {
  total_routes: number;
  total_stops: number;
  date: string;
  begin_time: string;
  end_time: string;
}

export interface ProcessResponse {
  routes: RoutesGeoJSON;
  stops: StopsGeoJSON;
  meta: ProcessMeta;
}

export interface ProcessParams {
  gtfsFile?: File;
  gtfsUrl?: string;
  yyyymmdd: string;
  beginTime: string;
  endTime: string;
  unifyStops: boolean;
  delimiter: string;
}
