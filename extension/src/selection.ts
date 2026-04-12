import type { FrozenBatchResult, FrozenCoverDraft, FrozenExportTask, FrozenSelectionSnapshot } from "./types";
import {
  FROZEN_SELECTION_DRAFT_STORAGE_KEY,
  FROZEN_SELECTION_STORAGE_KEY,
  mergeFrozenSelectionDraft
} from "./selection-storage";
import { buildAutomaticRanges, expandFrozenTasks, validateCoverRanges } from "./selection-cover-plan";
import { LOCAL_SERVER_BASE_URL } from "./utils";

const snapshotMeta = must<HTMLParagraphElement>("#snapshot-meta");
const selectionHint = must<HTMLParagraphElement>("#selection-hint");
const selectionCount = must<HTMLSpanElement>("#selection-count");
const selectionList = must<HTMLDivElement>("#selection-list");
const autoDistributeButton = must<HTMLButtonElement>("#auto-distribute-btn");
const addCoverButton = must<HTMLButtonElement>("#add-cover-btn");
const coverList = must<HTMLDivElement>("#cover-list");
const taskCount = must<HTMLSpanElement>("#task-count");
const taskSummary = must<HTMLDivElement>("#task-summary");
const startTimeInput = must<HTMLInputElement>("#start-time-input");
const endTimeInput = must<HTMLInputElement>("#end-time-input");
const exportButton = must<HTMLButtonElement>("#export-btn");
const statusText = must<HTMLParagraphElement>("#status-text");
const taskPreviewList = must<HTMLDivElement>("#task-preview-list");
const resultList = must<HTMLDivElement>("#result-list");
const clearButton = must<HTMLButtonElement>("#clear-btn");
const backButton = must<HTMLButtonElement>("#back-btn");

interface CoverUiState {
  draft: FrozenCoverDraft;
  file: File | null;
  fileName: string;
  previewUrl: string;
}

interface BatchSubmitInput {
  pageUrl: string;
  startTime: number;
  endTime: number;
  tasks: FrozenExportTask[];
  coversByStorageKey: Map<string, CoverUiState>;
  coverFieldByStorageKey: Map<string, string>;
}

let snapshot: FrozenSelectionSnapshot | null = null;
let covers: CoverUiState[] = [];
let isExporting = false;

const SERVER_BATCH_CONCURRENCY = 5;
const DEFAULT_START_TIME = 0;
const DEFAULT_END_TIME = 8;

void bootstrap();

async function bootstrap(): Promise<void> {
  startTimeInput.value = String(DEFAULT_START_TIME);
  endTimeInput.value = String(DEFAULT_END_TIME);

  addCoverButton.addEventListener("click", () => void handleAddCover());
  autoDistributeButton.addEventListener("click", handleAutoDistribute);
  exportButton.addEventListener("click", () => void handleExport());
  clearButton.addEventListener("click", () => void handleClear());
  backButton.addEventListener("click", () => void closeCurrentTab());

  await loadState();
  renderAll();
}

async function loadState(): Promise<void> {
  const stored = await chrome.storage.local.get([
    FROZEN_SELECTION_STORAGE_KEY,
    FROZEN_SELECTION_DRAFT_STORAGE_KEY
  ]);

  snapshot = (stored[FROZEN_SELECTION_STORAGE_KEY] as FrozenSelectionSnapshot | undefined) ?? null;
  const storedDrafts = (stored[FROZEN_SELECTION_DRAFT_STORAGE_KEY] as FrozenCoverDraft[] | undefined) ?? null;
  const mergedDrafts = mergeFrozenSelectionDraft(snapshot, storedDrafts);

  covers = mergedDrafts.map((draft) => ({
    draft,
    file: null,
    fileName: "",
    previewUrl: ""
  }));
}

function renderAll(): void {
  renderSnapshotSection();
  renderCoverEditor();
  renderTaskSection();
}

function renderSnapshotSection(): void {
  if (!snapshot) {
    snapshotMeta.textContent = "还没有锁定内容，先回到 side panel 点“锁定已选”。";
    selectionHint.textContent = "当前为空。锁定后的内容会稳定保留在这里。";
    selectionCount.textContent = "0 ITEMS";
    selectionCount.className = "badge pending";
    selectionList.innerHTML = `<div class="empty-block">还没有锁定视频。</div>`;
    return;
  }

  snapshotMeta.textContent = `${snapshot.pageTitle || "未命名页面"} | ${snapshot.pageUrl}`;
  selectionHint.textContent = `锁定时间：${new Date(snapshot.createdAt).toLocaleString()}`;
  selectionCount.textContent = `${snapshot.videos.length} ITEMS`;
  selectionCount.className = "badge ok";
  selectionList.innerHTML = "";

  snapshot.videos.forEach((item, index) => {
    const card = document.createElement("div");
    card.className = "locked-item";
    const durationText = typeof item.duration === "number" && item.duration > 0 ? `${item.duration.toFixed(1)}s` : "--";
    card.innerHTML = `
      <div class="preview-shell">
        <div class="ordinal-chip">#${index + 1}</div>
        <div class="duration-chip">${durationText}</div>
        <img class="preview-image" ${item.poster ? `src="${escapeHtml(item.poster)}"` : ""} alt="" loading="lazy" />
      </div>
      <div class="locked-meta">
        <strong class="locked-title">${escapeHtml(item.title || `视频 #${index + 1}`)}</strong>
        <div class="locked-url">${escapeHtml(item.src)}</div>
      </div>
    `;
    selectionList.appendChild(card);
  });
}

function renderCoverEditor(): void {
  coverList.innerHTML = "";

  if (!snapshot) {
    coverList.innerHTML = `<div class="empty-block">先锁定视频，再配置封面分配。</div>`;
    return;
  }

  if (covers.length === 0) {
    coverList.innerHTML = `<div class="empty-block">当前没有封面。点击“新增封面”开始配置。</div>`;
    return;
  }

  const validation = validateCoverRanges(snapshot.videos.length, covers.map((item) => ({
    from: item.draft.from,
    to: item.draft.to
  })));

  covers.forEach((cover, index) => {
    const invalid = validation.invalidRanges.find((issue) => issue.index === index);
    const card = document.createElement("div");
    card.className = `cover-card ${invalid ? "invalid" : ""}`;
    card.innerHTML = `
      <div class="cover-card-head">
        <div class="cover-card-title">
          <span class="eyebrow">COVER ${cover.draft.index}</span>
          <strong>${escapeHtml(cover.draft.name)}</strong>
        </div>
        <button class="button secondary small" type="button" data-remove-index="${index}">删除</button>
      </div>
      <div class="cover-card-body">
        <div class="preview-shell">
          ${
            cover.previewUrl
              ? `<img class="preview-image" src="${escapeHtml(cover.previewUrl)}" alt="" />`
              : `<div class="empty-block">未上传封面</div>`
          }
        </div>
        <div class="cover-controls">
          <div class="cover-picker-row">
            <input id="cover-file-${index}" class="file-input" type="file" accept="image/*" />
            <label for="cover-file-${index}" class="button secondary">选择封面</label>
            <span class="cover-file-meta">${escapeHtml(cover.fileName || "未选择文件")}</span>
          </div>
          <div class="cover-range-grid">
            <label class="field">
              <span class="field-label">FROM</span>
              <input class="input" type="number" min="0" step="1" value="${cover.draft.from}" data-field="from" data-index="${index}" />
            </label>
            <label class="field">
              <span class="field-label">TO</span>
              <input class="input" type="number" min="0" step="1" value="${cover.draft.to}" data-field="to" data-index="${index}" />
            </label>
          </div>
          <p class="card-message ${invalid ? "error" : ""}">${escapeHtml(invalid?.reason || "覆盖范围可手动调整，支持重叠。")}</p>
        </div>
      </div>
    `;

    const removeButton = card.querySelector(`[data-remove-index="${index}"]`) as HTMLButtonElement;
    removeButton.addEventListener("click", () => {
      void handleRemoveCover(index);
    });

    const fileInput = card.querySelector(`#cover-file-${index}`) as HTMLInputElement;
    fileInput.addEventListener("change", () => {
      handleCoverFileChange(index, fileInput.files?.[0] ?? null);
    });

    for (const input of card.querySelectorAll<HTMLInputElement>("[data-field]")) {
      input.addEventListener("input", () => {
        handleRangeChange(index, input.dataset.field as "from" | "to", Number(input.value));
      });
    }

    coverList.appendChild(card);
  });
}

function renderTaskSection(): void {
  if (!snapshot) {
    taskCount.textContent = "0 TASKS";
    taskCount.className = "badge pending";
    taskSummary.innerHTML = `<div class="empty-block">锁定视频后才会生成任务概览。</div>`;
    taskPreviewList.innerHTML = `<div class="empty-block">当前没有任务预览。</div>`;
    exportButton.disabled = true;
    return;
  }

  const validation = validateCoverRanges(snapshot.videos.length, covers.map((item) => ({
    from: item.draft.from,
    to: item.draft.to
  })));
  const expanded = expandFrozenTasks(
    snapshot.videos.map((item) => item.src),
    covers.map((item) => item.draft)
  );

  taskCount.textContent = `${expanded.tasks.length} TASKS`;
  taskCount.className = `badge ${expanded.tasks.length > 0 ? "ok" : "pending"}`;
  exportButton.disabled = isExporting || !validation.isValid || expanded.tasks.length === 0;

  const uncoveredText = expanded.uncoveredIndices.length > 0 ? expanded.uncoveredIndices.join(", ") : "无";
  taskSummary.innerHTML = `
    <div class="summary-card">
      <div class="eyebrow">FROZEN VIDEOS</div>
      <div class="summary-value">${snapshot.videos.length}</div>
      <div class="summary-detail">锁定后顺序固定，范围分配都基于这个编号。</div>
    </div>
    <div class="summary-card">
      <div class="eyebrow">COVERS</div>
      <div class="summary-value">${covers.length}</div>
      <div class="summary-detail">显式空封面状态会保留，直到你手动新增。</div>
    </div>
    <div class="summary-card ${validation.isValid ? "" : "error"}">
      <div class="eyebrow">VALIDATION</div>
      <div class="summary-value">${validation.invalidRanges.length}</div>
      <div class="summary-detail">${
        validation.invalidRanges.length > 0
          ? escapeHtml(validation.invalidRanges.map((item) => `#${item.index + 1}: ${item.reason}`).join(" | "))
          : "范围合法"
      }</div>
    </div>
    <div class="summary-card ${expanded.uncoveredIndices.length > 0 ? "warning" : ""}">
      <div class="eyebrow">UNCOVERED</div>
      <div class="summary-value">${expanded.uncoveredIndices.length}</div>
      <div class="summary-detail">未覆盖视频序号：${escapeHtml(uncoveredText)}</div>
    </div>
  `;

  if (expanded.tasks.length === 0) {
    taskPreviewList.innerHTML = `<div class="empty-block">当前还没有可执行任务。请先新增封面并调整范围。</div>`;
    return;
  }

  taskPreviewList.innerHTML = "";
  for (const task of expanded.tasks) {
    const video = snapshot.videos[task.videoIndex - 1];
    const row = document.createElement("div");
    row.className = "task-preview-item";
    row.innerHTML = `
      <div class="task-index">#${task.videoIndex}</div>
      <div class="task-cover-tag">cover-${task.coverIndex}</div>
      <div class="task-copy">
        <div class="task-title">${escapeHtml(video?.title || `视频 #${task.videoIndex}`)}</div>
        <div class="task-meta">taskId: ${escapeHtml(task.taskId)}</div>
        <div class="task-url">${escapeHtml(task.videoSrc)}</div>
      </div>
    `;
    taskPreviewList.appendChild(row);
  }
}

async function handleAddCover(): Promise<void> {
  if (!snapshot) {
    setStatus("请先从 side panel 锁定视频。");
    return;
  }

  const nextIndex = covers.length + 1;
  covers = [
    ...covers,
    {
      draft: {
        id: `cover-${snapshot.createdAt}-${crypto.randomUUID()}`,
        index: nextIndex,
        name: `Cover ${nextIndex}`,
        storageKey: `cover-${snapshot.createdAt}-${crypto.randomUUID()}`,
        from: Math.min(nextIndex, snapshot.videos.length),
        to: Math.min(nextIndex, snapshot.videos.length)
      },
      file: null,
      fileName: "",
      previewUrl: ""
    }
  ];
  await persistDrafts();
  renderAll();
}

function handleAutoDistribute(): void {
  if (!snapshot || covers.length === 0) {
    setStatus("请先锁定视频并至少新增一个封面。");
    return;
  }

  const ranges = buildAutomaticRanges({
    videoCount: snapshot.videos.length,
    coverCount: covers.length
  });

  const previousCoverCount = covers.length;
  const activeCoverCount = ranges.length;
  covers = covers.map((cover, index) => {
    if (index >= activeCoverCount) {
      const fallback = Math.max(1, snapshot.videos.length);
      return {
        ...cover,
        draft: {
          ...cover.draft,
          index: index + 1,
          name: `Cover ${index + 1}`,
          from: fallback,
          to: fallback
        }
      };
    }

    return {
      ...cover,
      draft: {
        ...cover.draft,
        index: index + 1,
        name: `Cover ${index + 1}`,
        from: ranges[index]!.from,
        to: ranges[index]!.to
      }
    };
  });

  void persistDrafts();
  setStatus(
    activeCoverCount < previousCoverCount
      ? "封面数量超过视频数量，已自动分配前面的封面；其余封面保留供你手动调整。"
      : "已按当前封面数量自动分配范围。"
  );
  renderAll();
}

function handleRangeChange(index: number, field: "from" | "to", value: number): void {
  covers = covers.map((cover, currentIndex) =>
    currentIndex === index
      ? {
          ...cover,
          draft: {
            ...cover.draft,
            [field]: Number.isFinite(value) ? value : 0
          }
        }
      : cover
  );
  void persistDrafts();
  renderAll();
}

function handleCoverFileChange(index: number, file: File | null): void {
  covers = covers.map((cover, currentIndex) => {
    if (currentIndex !== index) {
      return cover;
    }

    if (cover.previewUrl) {
      URL.revokeObjectURL(cover.previewUrl);
    }

    return {
      ...cover,
      file: file ?? null,
      fileName: file?.name || "",
      previewUrl: file ? URL.createObjectURL(file) : ""
    };
  });
  renderAll();
}

async function handleRemoveCover(index: number): Promise<void> {
  const next = covers.filter((_, currentIndex) => currentIndex !== index);
  covers = next.map((cover, currentIndex) => ({
    ...cover,
    draft: {
      ...cover.draft,
      index: currentIndex + 1,
      name: `Cover ${currentIndex + 1}`
    }
  }));
  await persistDrafts();
  renderAll();
}

async function persistDrafts(): Promise<void> {
  await chrome.storage.local.set({
    [FROZEN_SELECTION_DRAFT_STORAGE_KEY]: covers.map((item) => item.draft)
  });
}

async function handleExport(): Promise<void> {
  if (!snapshot) {
    setStatus("请先从 side panel 锁定视频。");
    return;
  }
  if (snapshot.videos.length === 0) {
    setStatus("没有锁定视频，无法导出。");
    return;
  }
  if (covers.length === 0) {
    setStatus("至少需要一个封面。");
    return;
  }

  const startTime = Number(startTimeInput.value);
  const endTime = Number(endTimeInput.value);
  if (!Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(endTime) || endTime <= startTime) {
    setStatus("导出时间范围不合法：endTime 必须大于 startTime。");
    return;
  }

  const validation = validateCoverRanges(snapshot.videos.length, covers.map((item) => ({
    from: item.draft.from,
    to: item.draft.to
  })));
  if (!validation.isValid) {
    setStatus("封面范围存在无效项，先修正后再导出。");
    return;
  }

  const expanded = expandFrozenTasks(
    snapshot.videos.map((item) => item.src),
    covers.map((item) => item.draft)
  );
  if (expanded.tasks.length === 0) {
    setStatus("当前没有可执行任务，请先调整封面范围。");
    return;
  }

  const coversByStorageKey = new Map(covers.map((cover) => [cover.draft.storageKey, cover]));
  const coverFieldByStorageKey = new Map(
    covers
      .filter((cover) => Boolean(cover.file))
      .map((cover) => [cover.draft.storageKey, `cover-${cover.draft.index}`])
  );
  const executableTasks = expanded.tasks.filter((task) => coverFieldByStorageKey.has(task.coverStorageKey));
  if (executableTasks.length === 0) {
    setStatus("请至少上传一个已参与范围分配的封面文件。");
    return;
  }

  const tooShortTasks = executableTasks.filter((task) => {
    const duration = snapshot?.videos[task.videoIndex - 1]?.duration;
    return typeof duration === "number" && duration > 0 && startTime >= duration;
  });
  if (tooShortTasks.length > 0) {
    setStatus(`存在视频总时长小于开始秒数（${startTime.toFixed(1)}），请调整后再试。`);
    return;
  }

  const willClampToEnd = executableTasks.some((task) => {
    const duration = snapshot?.videos[task.videoIndex - 1]?.duration;
    return typeof duration === "number" && duration > 0 && endTime > duration;
  });
  const ignoredTaskCount = expanded.tasks.length - executableTasks.length;

  isExporting = true;
  renderTaskSection();
  resultList.className = "result-list empty";
  resultList.textContent = "批量导出进行中…";
  setStatus(
    buildExportStatusMessage({
      prefix: `正在批量导出（服务端并发 ${SERVER_BATCH_CONCURRENCY}）…`,
      willClampToEnd,
      ignoredTaskCount
    })
  );

  try {
    const results = await exportBatchTasks({
      pageUrl: snapshot.pageUrl,
      startTime,
      endTime,
      tasks: executableTasks,
      coversByStorageKey,
      coverFieldByStorageKey
    });
    renderBatchResults(results);
    const successCount = results.filter((item) => item.success).length;
    setStatus(`批量导出完成：成功 ${successCount} 个，失败 ${results.length - successCount} 个`);
  } finally {
    isExporting = false;
    renderTaskSection();
  }
}

async function exportBatchTasks(input: BatchSubmitInput): Promise<FrozenBatchResult[]> {
  const formData = new FormData();
  formData.append("startTime", String(input.startTime));
  formData.append("endTime", String(input.endTime));
  formData.append("pageUrl", input.pageUrl);

  const uploadedFields = new Set<string>();
  for (const [storageKey, fieldName] of input.coverFieldByStorageKey.entries()) {
    const cover = input.coversByStorageKey.get(storageKey);
    if (!cover?.file || uploadedFields.has(fieldName)) {
      continue;
    }
    formData.append(fieldName, cover.file);
    uploadedFields.add(fieldName);
  }

  const normalizedTasks = input.tasks.map((task) => ({
    taskId: task.taskId,
    videoIndex: task.videoIndex,
    videoSrc: task.videoSrc,
    coverIndex: task.coverIndex,
    coverUploadField: input.coverFieldByStorageKey.get(task.coverStorageKey) || ""
  }));
  formData.append("tasks", JSON.stringify(normalizedTasks));

  try {
    const response = await fetch(`${LOCAL_SERVER_BASE_URL}/export/batch`, {
      method: "POST",
      body: formData
    });
    const payload = (await response.json()) as {
      ok: boolean;
      results?: FrozenBatchResult[];
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    if (!Array.isArray(payload.results)) {
      throw new Error("服务端没有返回批量结果");
    }
    return payload.results;
  } catch (error) {
    return input.tasks.map((task) => ({
      taskId: task.taskId,
      videoIndex: task.videoIndex,
      coverIndex: task.coverIndex,
      src: task.videoSrc,
      success: false,
      error: toErrorMessage(error)
    }));
  }
}

function renderBatchResults(results: FrozenBatchResult[]): void {
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
      <div><strong>${item.success ? "成功" : "失败"}</strong> · #${item.videoIndex} · cover-${item.coverIndex}</div>
      <div class="task-url">${escapeHtml(item.src)}</div>
      <div class="muted">${escapeHtml(item.outputPath || item.error || "")}</div>
    `;
    resultList.appendChild(element);
  }
}

async function handleClear(): Promise<void> {
  for (const cover of covers) {
    if (cover.previewUrl) {
      URL.revokeObjectURL(cover.previewUrl);
    }
  }
  covers = [];
  snapshot = null;
  await chrome.storage.local.remove([
    FROZEN_SELECTION_STORAGE_KEY,
    FROZEN_SELECTION_DRAFT_STORAGE_KEY
  ]);
  resultList.className = "result-list empty";
  resultList.textContent = "还没有导出结果";
  setStatus("已手动清空锁定内容和封面草稿。");
  renderAll();
}

async function closeCurrentTab(): Promise<void> {
  const current = await chrome.tabs.getCurrent();
  if (current?.id) {
    await chrome.tabs.remove(current.id);
    return;
  }
  window.close();
}

function setStatus(text: string): void {
  statusText.textContent = text;
}

function buildExportStatusMessage(input: {
  prefix: string;
  willClampToEnd: boolean;
  ignoredTaskCount: number;
}): string {
  const messages = [input.prefix];
  if (input.willClampToEnd) {
    messages.push("部分任务会自动裁到视频结尾。");
  }
  if (input.ignoredTaskCount > 0) {
    messages.push(`已忽略 ${input.ignoredTaskCount} 个未上传封面的任务。`);
  }
  return messages.join("");
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
