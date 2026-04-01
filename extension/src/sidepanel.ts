import type { ExportResultItem, TabVideoState, VideoCandidate } from "./types";
import { LOCAL_SERVER_BASE_URL } from "./utils";

const pageMeta = must<HTMLParagraphElement>("#page-meta");
const healthBadge = must<HTMLSpanElement>("#health-badge");
const healthText = must<HTMLParagraphElement>("#health-text");
const videoList = must<HTMLDivElement>("#video-list");
const coverInput = must<HTMLInputElement>("#cover-input");
const durationInput = must<HTMLInputElement>("#duration-input");
const exportButton = must<HTMLButtonElement>("#export-btn");
const refreshButton = must<HTMLButtonElement>("#refresh-btn");
const selectAllButton = must<HTMLButtonElement>("#select-all-btn");
const invertButton = must<HTMLButtonElement>("#invert-btn");
const statusText = must<HTMLParagraphElement>("#status-text");
const resultList = must<HTMLDivElement>("#result-list");

let currentTabId: number | null = null;
let currentState: TabVideoState | null = null;
let selectedIds = new Set<string>();

// side panel 只负责展示和交互，真正的 tab 数据通过 service worker 中转，
// 这样页面采集、后台缓存、用户操作三者边界清晰，也符合 MV3 的推荐方式。

void bootstrap();

async function bootstrap(): Promise<void> {
  exportButton.addEventListener("click", () => void handleExport());
  refreshButton.addEventListener("click", () => void refreshVideos());
  selectAllButton.addEventListener("click", handleSelectAll);
  invertButton.addEventListener("click", handleInvertSelection);

  currentTabId = await getCurrentTabId();
  await Promise.all([loadHealth(), loadVideos()]);
}

async function loadVideos(): Promise<void> {
  if (currentTabId === null) {
    pageMeta.textContent = "无法识别当前标签页";
    return;
  }

  const response = await chrome.runtime.sendMessage({
    type: "GET_TAB_VIDEOS",
    payload: { tabId: currentTabId }
  });

  currentState = response.data as TabVideoState | null;
  if (!currentState) {
    pageMeta.textContent = "当前页面还没有发现视频，先打开目标页面再试";
    renderVideoList([]);
    return;
  }

  pageMeta.textContent = `${currentState.pageTitle || "未命名页面"} | ${currentState.pageUrl}`;
  hydrateSelection(currentState.videos);
  renderVideoList(currentState.videos);
}

async function refreshVideos(): Promise<void> {
  if (currentTabId === null) {
    return;
  }
  setStatus("正在重新检测页面中的视频…");
  refreshButton.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({
      type: "REQUEST_TAB_REFRESH",
      payload: { tabId: currentTabId }
    });

    if (!response.ok) {
      throw new Error(response.error);
    }

    currentState = response.data as TabVideoState | null;
    hydrateSelection(currentState?.videos ?? []);
    renderVideoList(currentState?.videos ?? []);
    setStatus("检测已刷新");
  } catch (error) {
    setStatus(toErrorMessage(error));
  } finally {
    refreshButton.disabled = false;
  }
}

async function loadHealth(): Promise<void> {
  try {
    const response = await fetch(`${LOCAL_SERVER_BASE_URL}/health`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as { ok: boolean; ffmpeg: boolean };
    healthBadge.textContent = data.ok ? "正常" : "异常";
    healthBadge.className = `badge ${data.ok ? "ok" : "error"}`;
    healthText.textContent = data.ffmpeg
      ? "本地服务和 ffmpeg 都已就绪"
      : "本地服务已启动，但 ffmpeg 不可用";
  } catch (error) {
    healthBadge.textContent = "未连接";
    healthBadge.className = "badge error";
    healthText.textContent = `无法连接本地服务：${toErrorMessage(error)}`;
  }
}

async function handleExport(): Promise<void> {
  const exportableVideos = (currentState?.videos ?? []).filter(
    (item) => selectedIds.has(item.id) && item.exportable
  );
  const duration = Number(durationInput.value);
  const coverFile = coverInput.files?.[0];

  if (!coverFile) {
    setStatus("请先上传图片");
    return;
  }
  if (!Number.isInteger(duration) || duration <= 0) {
    setStatus("导出秒数必须是正整数");
    return;
  }
  if (!currentState?.pageUrl) {
    setStatus("当前页面信息缺失，请刷新检测后再试");
    return;
  }
  if (exportableVideos.length === 0) {
    setStatus("请至少勾选一个可导出的 mp4");
    return;
  }

  exportButton.disabled = true;
  setStatus("正在发送导出任务到本地服务…");

  try {
    const formData = new FormData();
    formData.append("cover", coverFile);
    formData.append("duration", String(duration));
    formData.append("pageUrl", currentState.pageUrl);
    formData.append("videos", JSON.stringify(exportableVideos.map((item) => item.src)));

    const response = await fetch(`${LOCAL_SERVER_BASE_URL}/export`, {
      method: "POST",
      body: formData
    });
    const data = (await response.json()) as { ok: boolean; results: ExportResultItem[]; error?: string };
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    renderResults(data.results);
    const successCount = data.results.filter((item) => item.success).length;
    setStatus(`导出完成：成功 ${successCount} 个，失败 ${data.results.length - successCount} 个`);
  } catch (error) {
    setStatus(`导出失败：${toErrorMessage(error)}`);
  } finally {
    exportButton.disabled = false;
  }
}

function renderVideoList(videos: VideoCandidate[]): void {
  if (videos.length === 0) {
    videoList.innerHTML = `<div class="empty">当前还没有发现视频资源。确认页面已经加载完成，必要时点“刷新检测”。</div>`;
    return;
  }

  videoList.innerHTML = "";
  for (const item of videos) {
    const wrapper = document.createElement("div");
    wrapper.className = `video-item ${item.exportable ? "" : "disabled"}`;

    const checked = selectedIds.has(item.id) ? "checked" : "";
    const disabled = item.exportable ? "" : "disabled";
    const posterHtml = item.poster ? `<div class="chip">poster</div>` : "";
    const durationHtml = item.duration ? `<div class="chip">${item.duration.toFixed(1)}s</div>` : "";
    const sizeHtml =
      item.width && item.height ? `<div class="chip">${item.width}x${item.height}</div>` : "";
    const reasonHtml = item.exportable
      ? ""
      : `<div class="chip warn">${escapeHtml(item.unsupportedReason)}</div>`;

    wrapper.innerHTML = `
      <label>
        <input type="checkbox" data-id="${escapeHtml(item.id)}" ${checked} ${disabled} />
        <div>
          <div class="video-title">${escapeHtml(item.title || "未命名视频")}</div>
          <div class="video-url">${escapeHtml(item.src)}</div>
          <div class="meta">
            <div class="chip">${escapeHtml(item.sourceType)}</div>
            ${durationHtml}
            ${sizeHtml}
            ${posterHtml}
            ${reasonHtml}
          </div>
        </div>
      </label>
    `;

    const checkbox = wrapper.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox?.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
    });
    videoList.appendChild(wrapper);
  }
}

function renderResults(results: ExportResultItem[]): void {
  if (results.length === 0) {
    resultList.className = "result-list empty";
    resultList.textContent = "没有返回结果";
    return;
  }

  resultList.className = "result-list";
  resultList.innerHTML = "";
  for (const item of results) {
    const element = document.createElement("div");
    element.className = "result-item";
    element.innerHTML = `
      <div><strong>${item.success ? "成功" : "失败"}</strong></div>
      <div class="video-url">${escapeHtml(item.src)}</div>
      <div class="muted">${escapeHtml(item.outputPath || item.error || "")}</div>
    `;
    resultList.appendChild(element);
  }
}

function handleSelectAll(): void {
  const videos = currentState?.videos ?? [];
  selectedIds = new Set(videos.filter((item) => item.exportable).map((item) => item.id));
  renderVideoList(videos);
}

function handleInvertSelection(): void {
  const next = new Set<string>();
  for (const item of currentState?.videos ?? []) {
    if (!item.exportable) {
      continue;
    }
    if (!selectedIds.has(item.id)) {
      next.add(item.id);
    }
  }
  selectedIds = next;
  renderVideoList(currentState?.videos ?? []);
}

async function getCurrentTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return typeof tab?.id === "number" ? tab.id : null;
}

function hydrateSelection(videos: VideoCandidate[]): void {
  const availableIds = new Set(videos.map((item) => item.id));
  selectedIds = new Set([...selectedIds].filter((id) => availableIds.has(id)));
}

function setStatus(text: string): void {
  statusText.textContent = text;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function must<T extends Element>(selector: string): T {
  const node = document.querySelector(selector);
  if (!node) {
    throw new Error(`Missing element: ${selector}`);
  }
  return node as T;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

