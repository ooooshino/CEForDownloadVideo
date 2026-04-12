import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OUTPUT_DIR, TMP_DIR } from "../config.js";

export async function ensureBaseDirs(): Promise<void> {
  await Promise.all([mkdir(TMP_DIR, { recursive: true }), mkdir(OUTPUT_DIR, { recursive: true })]);
}

export async function createJobDir(): Promise<string> {
  await ensureBaseDirs();
  return mkdtemp(path.join(TMP_DIR, "job-"));
}

export function safeBaseName(input: string): string {
  return input.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "video";
}

export function buildOutputFileName(pageUrl: string, index: number, coverIndex = 0): string {
  const hostname = toHostname(pageUrl);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${hostname}-video-${index + 1}-cover-${coverIndex + 1}-${stamp}.mp4`;
}

export function createTempFilePath(jobDir: string, name: string): string {
  return path.join(jobDir, name);
}

export function getOutputPath(filename: string): string {
  return path.join(OUTPUT_DIR, filename);
}

function toHostname(url: string): string {
  try {
    return safeBaseName(new URL(url).hostname);
  } catch {
    return safeBaseName(os.hostname());
  }
}
