import os from "node:os";
import path from "node:path";

export const SERVER_PORT = Number(process.env.VIDEO_EXPORT_SERVER_PORT || 37891);
export const SERVER_HOST = process.env.VIDEO_EXPORT_SERVER_HOST || "127.0.0.1";
export const TMP_DIR = path.join(os.tmpdir(), "download-video-local-server");
export const OUTPUT_DIR = path.join(os.homedir(), "Downloads", "cutVideo");
export const DOWNLOAD_PROXY_ENABLED = !["0", "false", "off"].includes(
  (process.env.VIDEO_EXPORT_PROXY_ENABLED || "true").toLowerCase()
);
export const DOWNLOAD_PROXY_HOST = process.env.VIDEO_EXPORT_PROXY_HOST || "127.0.0.1";
export const DOWNLOAD_PROXY_PORT = Number(process.env.VIDEO_EXPORT_PROXY_PORT || 7890);
export const BATCH_EXPORT_CONCURRENCY = parsePositiveInt(
  process.env.VIDEO_EXPORT_BATCH_CONCURRENCY,
  5
);

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    return fallback;
  }
  return Math.floor(value);
}
