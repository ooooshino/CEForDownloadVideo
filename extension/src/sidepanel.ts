import type { ExportResultItem, TabVideoState, VideoCandidate } from "./types";
import { LOCAL_SERVER_BASE_URL } from "./utils";

const pageMeta = must<HTMLParagraphElement>("#page-meta");
const healthBadge = must<HTMLSpanElement>("#health-badge");
const healthText = must<HTMLParagraphElement>("#health-text");
const videoList = must<HTMLDivElement>("#video-list");
const coverInput = must<HTMLInputElement>("#cover-input");
const startTimeInput = must<HTMLInputElement>("#start-time-input");
const endTimeInput = must<HTMLInputElement>("#end-time-input");
const exportButton = must<HTMLButtonElement>("#export-btn");
const refreshButton = must<HTMLButtonElement>("#refresh-btn");
const selectAllButton = must<HTMLButtonElement>("#select-all-btn");
const invertButton = must<HTMLButtonElement>("#invert-btn");
const statusText = must<HTMLParagraphElement>("#status-text");
const resultList = must<HTMLDivElement>("#result-list");

let currentTabId: number | null = null;
let currentState: TabVideoState | null = null;
let selectedIds = new Set<string>();
let refreshTimer: number | null = null;
let isRefreshing = false;
let activeVideoId: string | null = null;

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
  startAutoRefresh();
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

async function refreshVideos(options: { silent?: boolean } = {}): Promise<void> {
  if (currentTabId === null || isRefreshing) {
    return;
  }
  if (options.silent && isPreviewActive()) {
    return;
  }

  isRefreshing = true;
  refreshButton.disabled = true;
  if (!options.silent) {
    setStatus("正在重新检测页面中的视频…");
  }

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
    syncActiveVideo(currentState?.videos ?? []);
    if (!(options.silent && isPreviewActive())) {
      renderVideoList(currentState?.videos ?? []);
    }
    if (!options.silent) {
      setStatus("检测已刷新");
    }
  } catch (error) {
    if (!options.silent) {
      setStatus(toErrorMessage(error));
    }
  } finally {
    isRefreshing = false;
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
  const startTime = Number(startTimeInput.value);
  const endTime = Number(endTimeInput.value);
  const coverFile = coverInput.files?.[0];

  if (!coverFile) {
    setStatus("请先上传图片");
    return;
  }
  if (!Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(endTime)) {
    setStatus("请填写正确的裁剪范围，比如 0 到 8");
    return;
  }
  if (endTime <= startTime) {
    setStatus("结束秒数必须大于开始秒数");
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

  const tooShortVideos = exportableVideos.filter(
    (item) => typeof item.duration === "number" && item.duration > 0 && startTime >= item.duration
  );
  if (tooShortVideos.length > 0) {
    setStatus("开始秒数不能大于或等于视频总时长");
    return;
  }

  exportButton.disabled = true;
  const willClampToEnd = exportableVideos.some(
    (item) => typeof item.duration === "number" && item.duration > 0 && endTime > item.duration
  );
  setStatus(willClampToEnd ? "部分视频会自动裁到结尾，正在导出…" : "正在发送导出任务到本地服务…");

  try {
    const formData = new FormData();
    formData.append("cover", coverFile);
    formData.append("startTime", String(startTime));
    formData.append("endTime", String(endTime));
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
    const activeText = !canPreviewCandidate(item)
      ? "不可预览"
      : activeVideoId === item.id
        ? "播放中"
        : "悬停预览";
    const durationText = typeof item.duration === "number" && item.duration > 0 ? `${item.duration.toFixed(1)}s` : "--";

    wrapper.innerHTML = `
      <div class="preview-shell">
        <label class="picker">
          <input type="checkbox" data-id="${escapeHtml(item.id)}" ${checked} ${disabled} />
        </label>
        <div class="duration-chip">${durationText}</div>
        <img
          class="preview-image ${item.poster ? "" : "hidden"}"
          src="${escapeHtml(item.poster || "")}"
          alt=""
          loading="lazy"
          data-preview-image-id="${escapeHtml(item.id)}"
        />
        <button class="preview-trigger ${item.poster ? "" : "hidden"}" type="button" data-trigger-id="${escapeHtml(item.id)}" tabindex="-1">
          <span class="play-overlay">${activeText}</span>
        </button>
        <video
          class="preview ${item.poster ? "hidden" : ""}"
          controls
          preload="metadata"
          muted
          playsinline
          data-video-id="${escapeHtml(item.id)}"
          data-src="${escapeHtml(item.src)}"
        ></video>
      </div>
    `;

    const checkbox = wrapper.querySelector("input[type=checkbox]") as HTMLInputElement;
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        selectedIds.add(item.id);
      } else {
        selectedIds.delete(item.id);
      }
    });

    const shell = wrapper.querySelector(".preview-shell") as HTMLDivElement;
    const player = wrapper.querySelector("video") as HTMLVideoElement;
    const image = wrapper.querySelector("[data-preview-image-id]") as HTMLImageElement | null;

    shell.addEventListener("mouseenter", () => {
      void activateVideo(item.id, { autoplay: true });
    });
    shell.addEventListener("mouseleave", () => {
      if (activeVideoId === item.id) {
        stopActivePreview(item.id);
      }
    });
    player.addEventListener("play", () => {
      void activateVideo(item.id, { autoplay: true });
    });
    player.addEventListener("pause", () => {
      if (activeVideoId === item.id && !player.matches(":hover") && !shell.matches(":hover")) {
        stopActivePreview(item.id);
      }
    });
    image?.addEventListener("mouseenter", () => {
      void activateVideo(item.id, { autoplay: true });
    });

    videoList.appendChild(wrapper);
  }
}

async function activateVideo(videoId: string, options: { autoplay: boolean }): Promise<void> {
  if (!currentState) {
    return;
  }

  const target = currentState.videos.find((item) => item.id === videoId);
  if (!target || !canPreviewCandidate(target)) {
    return;
  }

  for (const element of videoList.querySelectorAll("video")) {
    const player = element as HTMLVideoElement;
    if (player.dataset.videoId !== videoId) {
      releaseVideoElement(player);
    }
  }

  activeVideoId = videoId;
  const activePlayer = findActivePlayer();
  if (!activePlayer) {
    return;
  }

  showVideoPlayer(videoId);
  ensurePlayerLoaded(activePlayer);
  activePlayer.muted = false;
  renderActiveBadge(videoId);

  if (options.autoplay) {
    try {
      await activePlayer.play();
    } catch {
      // 某些站点视频资源需要用户继续和播放器控件交互，这里不打断界面流程。
    }
  }
}

function ensurePlayerLoaded(player: HTMLVideoElement): void {
  if (player.dataset.loaded === "true") {
    return;
  }

  const src = player.dataset.src;
  if (!src) {
    return;
  }

  player.src = src;
  player.dataset.loaded = "true";
  player.load();
}

function releaseVideoElement(player: HTMLVideoElement): void {
  player.pause();
  player.muted = true;
  player.removeAttribute("src");
  player.dataset.loaded = "false";
  player.load();

  const videoId = player.dataset.videoId;
  if (!videoId) {
    return;
  }
  showPosterPreview(videoId);
}

function stopActivePreview(videoId: string): void {
  const player = videoList.querySelector(`video[data-video-id="${CSS.escape(videoId)}"]`) as HTMLVideoElement | null;
  if (!player) {
    return;
  }
  releaseVideoElement(player);
  if (activeVideoId === videoId) {
    activeVideoId = null;
    renderActiveBadge("");
  }
}

function renderActiveBadge(videoId: string): void {
  for (const item of videoList.querySelectorAll(".video-item")) {
    const player = item.querySelector("video") as HTMLVideoElement | null;
    const badge = item.querySelector(".play-overlay") as HTMLElement | null;
    if (!player || !badge) {
      continue;
    }
    if (badge.textContent === "不可预览") {
      continue;
    }
    badge.textContent = player.dataset.videoId === videoId ? "播放中" : "悬停预览";
  }
}

function findActivePlayer(): HTMLVideoElement | null {
  if (!activeVideoId) {
    return null;
  }
  return videoList.querySelector(`video[data-video-id="${CSS.escape(activeVideoId)}"]`) as HTMLVideoElement | null;
}

function startAutoRefresh(): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }

  refreshTimer = window.setInterval(() => {
    void loadHealth();
    if (!isPreviewActive()) {
      void refreshVideos({ silent: true });
    }
  }, 5000);
}

function isPreviewActive(): boolean {
  if (!activeVideoId) {
    return false;
  }

  const activePlayer = findActivePlayer();
  if (!activePlayer) {
    return false;
  }

  const shell = activePlayer.closest(".preview-shell");
  return !activePlayer.paused || Boolean(shell?.matches(":hover"));
}

function showVideoPlayer(videoId: string): void {
  const image = videoList.querySelector(`[data-preview-image-id="${CSS.escape(videoId)}"]`) as HTMLImageElement | null;
  const trigger = videoList.querySelector(`[data-trigger-id="${CSS.escape(videoId)}"]`) as HTMLButtonElement | null;
  const player = videoList.querySelector(`video[data-video-id="${CSS.escape(videoId)}"]`) as HTMLVideoElement | null;
  image?.classList.add("hidden");
  trigger?.classList.add("hidden");
  player?.classList.remove("hidden");
}

function showPosterPreview(videoId: string): void {
  const image = videoList.querySelector(`[data-preview-image-id="${CSS.escape(videoId)}"]`) as HTMLImageElement | null;
  const trigger = videoList.querySelector(`[data-trigger-id="${CSS.escape(videoId)}"]`) as HTMLButtonElement | null;
  const player = videoList.querySelector(`video[data-video-id="${CSS.escape(videoId)}"]`) as HTMLVideoElement | null;
  if (image && image.getAttribute("src")) {
    image.classList.remove("hidden");
    trigger?.classList.remove("hidden");
    player?.classList.add("hidden");
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

function syncActiveVideo(videos: VideoCandidate[]): void {
  if (
    activeVideoId &&
    !videos.some((item) => item.id === activeVideoId && canPreviewCandidate(item))
  ) {
    activeVideoId = null;
  }
}

function canPreviewCandidate(candidate: VideoCandidate): boolean {
  return !candidate.src.startsWith("blob:");
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

window.addEventListener("beforeunload", () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
  for (const element of videoList.querySelectorAll("video")) {
    releaseVideoElement(element as HTMLVideoElement);
  }
});
