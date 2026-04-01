import { mkdir } from "node:fs/promises";
import { Router } from "express";
import multer from "multer";
import { createJobDir, createTempFilePath } from "../utils/files.js";
import { processVideo } from "../services/ffmpeg.js";
import { downloadToFile, asFailure } from "../services/downloader.js";
import { logError, logInfo } from "../utils/logger.js";
import type { ExportResultItem } from "../types.js";

const upload = multer({ dest: "tmp/uploads" });

export const exportRouter = Router();

exportRouter.use(async (_req, _res, next) => {
  await mkdir("tmp/uploads", { recursive: true });
  next();
});

exportRouter.post("/", upload.single("cover"), async (req, res) => {
  const coverPath = req.file?.path;
  const duration = Number(req.body.duration);
  const pageUrl = String(req.body.pageUrl || "");
  const videos = parseVideos(req.body.videos);

  if (!coverPath) {
    res.status(400).json({ ok: false, error: "缺少 cover 文件" });
    return;
  }
  if (!Number.isInteger(duration) || duration <= 0) {
    res.status(400).json({ ok: false, error: "duration 必须是正整数" });
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

  logInfo("Received export request", { pageUrl, duration, count: videos.length });

  const results: ExportResultItem[] = [];
  for (const [index, src] of videos.entries()) {
    try {
      const jobDir = await createJobDir();
      const downloadPath = createTempFilePath(jobDir, `source-${index + 1}.mp4`);

      await downloadToFile(src, downloadPath);
      const outputPath = await processVideo({
        src,
        pageUrl,
        duration,
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
