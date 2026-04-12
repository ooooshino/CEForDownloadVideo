import { mkdir } from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { createJobDir, createTempFilePath } from "../utils/files.js";
import { processVideo } from "../services/ffmpeg.js";
import { downloadToFile, asFailure } from "../services/downloader.js";
import { processBatchExport } from "../services/batch-export.js";
import { logError, logInfo } from "../utils/logger.js";
import type { BatchExportTask, ExportResultItem } from "../types.js";
import { BATCH_EXPORT_CONCURRENCY } from "../config.js";

const upload = multer({ dest: "tmp/uploads" });

export const exportRouter = Router();

exportRouter.use(async (_req, _res, next) => {
  await mkdir("tmp/uploads", { recursive: true });
  next();
});

exportRouter.post("/", upload.single("cover"), async (req, res) => {
  const coverPath = req.file?.path;
  const startTime = Number(req.body.startTime);
  const endTime = Number(req.body.endTime);
  const pageUrl = String(req.body.pageUrl || "");
  const videos = parseVideos(req.body.videos);

  if (!coverPath) {
    res.status(400).json({ ok: false, error: "缺少 cover 文件" });
    return;
  }
  if (!Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(endTime) || endTime <= startTime) {
    res.status(400).json({ ok: false, error: "startTime 和 endTime 不合法" });
    return;
  }
  if (!pageUrl) {
    res.status(400).json({ ok: false, error: "缺少 pageUrl" });
    return;
  }
  if (videos.length === 0) {
    res.status(400).json({ ok: false, error: "至少传一个视频地址" });
    return;
  }

  logInfo("Received export request", { pageUrl, startTime, endTime, count: videos.length });

  const results: ExportResultItem[] = [];
  for (const [index, src] of videos.entries()) {
    try {
      const jobDir = await createJobDir();
      const downloadPath = createTempFilePath(jobDir, `source-${index + 1}.mp4`);

      await downloadToFile(src, downloadPath);
      const outputPath = await processVideo({
        src,
        pageUrl,
        startTime,
        endTime,
        coverPath,
        downloadPath,
        jobDir,
        index
      });

      results.push({
        src,
        success: true,
        outputPath
      });
    } catch (error) {
      logError("Export item failed", { src, error });
      results.push(asFailure(src, error));
    }
  }

  res.json({ ok: true, results });
});

exportRouter.post("/batch", upload.any(), async (req, res) => {
  const parseResult = parseBatchRequest(req.body, req.files);
  if (!parseResult.ok) {
    res.status(400).json({ ok: false, error: parseResult.error });
    return;
  }

  const { pageUrl, startTime, endTime, tasks, coverPathByField } = parseResult.value;
  logInfo("Received batch export request", {
    pageUrl,
    startTime,
    endTime,
    taskCount: tasks.length,
    coverCount: coverPathByField.size
  });

  const results = await processBatchExport(tasks, async (task) => {
    const coverPath = coverPathByField.get(task.coverUploadField);
    if (!coverPath) {
      throw new Error(`缺少封面文件字段: ${task.coverUploadField}`);
    }

    const jobDir = await createJobDir();
    const downloadPath = createTempFilePath(
      jobDir,
      `source-v${task.videoIndex + 1}-c${task.coverIndex + 1}.mp4`
    );

    await downloadToFile(task.videoSrc, downloadPath);
    const outputPath = await processVideo({
      src: task.videoSrc,
      pageUrl,
      startTime,
      endTime,
      coverPath,
      downloadPath,
      jobDir,
      index: task.videoIndex,
      coverIndex: task.coverIndex
    });

    return {
      taskId: task.taskId,
      videoIndex: task.videoIndex,
      coverIndex: task.coverIndex,
      src: task.videoSrc,
      success: true,
      outputPath
    };
  }, BATCH_EXPORT_CONCURRENCY);

  res.json({ ok: true, results });
});

interface BatchRequestValue {
  pageUrl: string;
  startTime: number;
  endTime: number;
  tasks: BatchExportTask[];
  coverPathByField: Map<string, string>;
}

type BatchRequestParseResult =
  | { ok: true; value: BatchRequestValue }
  | { ok: false; error: string };

export function parseBatchRequest(body: unknown, files: unknown): BatchRequestParseResult {
  const data = toRecord(body);
  const pageUrl = toTrimmedString(data.pageUrl);
  if (!pageUrl) {
    return { ok: false, error: "缺少 pageUrl" };
  }

  const startTime = Number(data.startTime);
  const endTime = Number(data.endTime);
  if (!Number.isFinite(startTime) || startTime < 0 || !Number.isFinite(endTime) || endTime <= startTime) {
    return { ok: false, error: "startTime 和 endTime 不合法" };
  }

  const tasks = parseBatchTasks(data.tasks);
  if (tasks.length === 0) {
    return { ok: false, error: "tasks 不能为空" };
  }

  const uploaded = normalizeUploadFiles(files);
  const coverPathByField = new Map(uploaded.map((file) => [file.fieldname, file.path]));

  const missingField = tasks.find((task) => !coverPathByField.has(task.coverUploadField));
  if (missingField) {
    return {
      ok: false,
      error: `缺少封面文件字段: ${missingField.coverUploadField}`
    };
  }

  return {
    ok: true,
    value: {
      pageUrl,
      startTime,
      endTime,
      tasks,
      coverPathByField
    }
  };
}

function parseVideos(raw: unknown): string[] {
  if (typeof raw !== "string") {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

function parseBatchTasks(raw: unknown): BatchExportTask[] {
  if (typeof raw !== "string") {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter(isBatchExportTask);
  } catch {
    return [];
  }
}

function isBatchExportTask(value: unknown): value is BatchExportTask {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Record<string, unknown>;
  return (
    typeof data.taskId === "string" &&
    data.taskId.length > 0 &&
    Number.isInteger(data.videoIndex) &&
    Number(data.videoIndex) >= 0 &&
    typeof data.videoSrc === "string" &&
    data.videoSrc.length > 0 &&
    Number.isInteger(data.coverIndex) &&
    Number(data.coverIndex) >= 0 &&
    typeof data.coverUploadField === "string" &&
    data.coverUploadField.length > 0
  );
}

function normalizeUploadFiles(files: unknown): Array<{ fieldname: string; path: string }> {
  if (!Array.isArray(files)) {
    return [];
  }
  return files
    .filter((file): file is { fieldname: string; path: string } => {
      if (!file || typeof file !== "object") {
        return false;
      }
      const value = file as Record<string, unknown>;
      return typeof value.fieldname === "string" && typeof value.path === "string";
    })
    .filter((file) => file.fieldname.length > 0 && file.path.length > 0);
}

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
