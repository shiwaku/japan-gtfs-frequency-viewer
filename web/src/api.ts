import { aggregateGtfs } from "./gtfs_parser";
import type { ProcessParams, ProcessResponse } from "./types";

export async function processGtfs(params: ProcessParams): Promise<ProcessResponse> {
  const source = params.gtfsFile ?? params.gtfsUrl;
  if (!source) throw new Error("gtfsFile または gtfsUrl のいずれかが必要です。");

  return aggregateGtfs(source, {
    yyyymmdd: params.yyyymmdd,
    beginTime: params.beginTime,
    endTime: params.endTime,
    unifyStops: params.unifyStops,
    delimiter: params.delimiter,
  });
}
