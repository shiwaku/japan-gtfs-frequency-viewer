import type { ProcessMeta, ProcessParams } from "./types";

// ---------------------------------------------------------------------------
// DOM 要素参照
// ---------------------------------------------------------------------------
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;

export const els = {
  tabBtns: document.querySelectorAll<HTMLButtonElement>(".tab-btn"),
  tabPanels: document.querySelectorAll<HTMLDivElement>(".tab-panel"),
  gtfsFile: $<HTMLInputElement>("gtfs-file"),
  gtfsUrl: $<HTMLInputElement>("gtfs-url"),
  filterDate: $<HTMLInputElement>("filter-date"),
  timeFilterEnabled: $<HTMLInputElement>("time-filter-enabled"),
  timeFilterInputs: $<HTMLDivElement>("time-filter-inputs"),
  beginTime: $<HTMLInputElement>("begin-time"),
  endTime: $<HTMLInputElement>("end-time"),
  unifyStops: $<HTMLInputElement>("unify-stops"),
  delimiterOption: $<HTMLDivElement>("delimiter-option"),
  delimiter: $<HTMLInputElement>("delimiter"),
  runBtn: $<HTMLButtonElement>("run-btn"),
  statusBar: $<HTMLDivElement>("status-bar"),
  layerControls: $<HTMLElement>("layer-controls"),
  metaSection: $<HTMLElement>("meta-section"),
  metaInfo: $<HTMLDivElement>("meta-info"),
  toggleRoutes: $<HTMLInputElement>("toggle-routes"),
  toggleRouteLabels: $<HTMLInputElement>("toggle-route-labels"),
  toggleStops: $<HTMLInputElement>("toggle-stops"),
  toggleStopLabels: $<HTMLInputElement>("toggle-stop-labels"),
};

// ---------------------------------------------------------------------------
// 初期化
// ---------------------------------------------------------------------------
export function initUi(): void {
  // タブ切替
  els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      els.tabBtns.forEach((b) => b.classList.remove("active"));
      els.tabPanels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      const panel = document.getElementById(`tab-${btn.dataset["tab"]}`);
      panel?.classList.add("active");
    });
  });

  // 時間帯フィルタ切替
  els.timeFilterEnabled.addEventListener("change", () => {
    setSubOptionEnabled(els.timeFilterInputs, els.timeFilterEnabled.checked);
  });
  setSubOptionEnabled(els.timeFilterInputs, false);

  // 停留所統合切替
  els.unifyStops.addEventListener("change", () => {
    setSubOptionEnabled(els.delimiterOption, els.unifyStops.checked);
  });
}

function setSubOptionEnabled(el: HTMLElement, enabled: boolean): void {
  el.style.opacity = enabled ? "1" : "0.4";
  el.style.pointerEvents = enabled ? "auto" : "none";
}

// ---------------------------------------------------------------------------
// 入力値収集
// ---------------------------------------------------------------------------
export function collectParams(): ProcessParams | null {
  const activeTab = document.querySelector<HTMLButtonElement>(".tab-btn.active")
    ?.dataset["tab"];

  if (activeTab === "file") {
    if (!els.gtfsFile.files?.length) {
      showStatus("GTFSファイルを選択してください。", "error");
      return null;
    }
    return buildParams({ gtfsFile: els.gtfsFile.files[0] });
  } else {
    const url = els.gtfsUrl.value.trim();
    if (!url) {
      showStatus("GTFSのURLを入力してください。", "error");
      return null;
    }
    return buildParams({ gtfsUrl: url });
  }
}

function buildParams(
  source: Pick<ProcessParams, "gtfsFile" | "gtfsUrl">
): ProcessParams {
  const dateVal = els.filterDate.value;
  const yyyymmdd = dateVal ? dateVal.replace(/-/g, "") : "";

  const useTimeFilter = els.timeFilterEnabled.checked;

  return {
    ...source,
    yyyymmdd,
    beginTime: useTimeFilter ? els.beginTime.value : "",
    endTime: useTimeFilter ? els.endTime.value : "",
    unifyStops: els.unifyStops.checked,
    delimiter: els.delimiter.value,
  };
}

// ---------------------------------------------------------------------------
// ステータス表示
// ---------------------------------------------------------------------------
export type StatusType = "info" | "success" | "error";

export function showStatus(message: string, type: StatusType): void {
  els.statusBar.textContent = message;
  els.statusBar.className = `status-${type}`;
}

export function clearStatus(): void {
  els.statusBar.textContent = "";
  els.statusBar.className = "";
}

// ---------------------------------------------------------------------------
// 処理中ボタン状態
// ---------------------------------------------------------------------------
export function setRunning(running: boolean): void {
  els.runBtn.disabled = running;
  els.runBtn.innerHTML = running
    ? '<span class="spinner"></span>処理中...'
    : "処理実行";
}

// ---------------------------------------------------------------------------
// 処理結果の表示
// ---------------------------------------------------------------------------
export function showResults(meta: ProcessMeta): void {
  const lines = [
    `路線セグメント数: <b>${meta.total_routes.toLocaleString()}</b>`,
    `停留所数: <b>${meta.total_stops.toLocaleString()}</b>`,
    meta.date ? `対象日付: <b>${meta.date}</b>` : null,
    meta.begin_time && meta.end_time
      ? `時間帯: <b>${meta.begin_time} 〜 ${meta.end_time}</b>`
      : null,
  ].filter(Boolean);

  els.metaInfo.innerHTML = lines.join("<br />");
  els.layerControls.hidden = false;
  els.metaSection.hidden = false;
}

export function hideResults(): void {
  els.layerControls.hidden = true;
  els.metaSection.hidden = true;
}
