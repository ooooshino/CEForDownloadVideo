import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { ExportResultItem } from "../types.js";
import { logInfo } from "../utils/logger.js";

export async function downloadToFile(url: string, outputPath: string): Promise<void> {
  logInfo("Downloading source video", { url, outputPath });
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`下载失败: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(outputPath));
}

export function asFailure(src: string, error: unknown): ExportResultItem {
  return {
    src,
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

