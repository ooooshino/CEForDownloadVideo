import os from "node:os";
import path from "node:path";

export const SERVER_PORT = Number(process.env.VIDEO_EXPORT_SERVER_PORT || 37891);
export const SERVER_HOST = process.env.VIDEO_EXPORT_SERVER_HOST || "127.0.0.1";
export const TMP_DIR = path.join(os.tmpdir(), "download-video-local-server");
export const OUTPUT_DIR = path.join(os.homedir(), "Downloads", "cutVideo");
