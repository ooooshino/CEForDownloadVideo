import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import http from "node:http";
import https from "node:https";
import type { ExportResultItem } from "../types.js";
import { logInfo } from "../utils/logger.js";

const CONNECT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 3;

export async function downloadToFile(url: string, outputPath: string): Promise<void> {
  logInfo("Downloading source video", { url, outputPath });

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      await downloadOnce(url, outputPath);
      return;
    } catch (error) {
      lastError = error;
      logInfo("Download retry scheduled", {
        url,
        attempt,
        maxRetries: MAX_RETRIES,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function asFailure(src: string, error: unknown): ExportResultItem {
  return {
    src,
    success: false,
    error: error instanceof Error ? error.message : String(error)
  };
}

async function downloadOnce(url: string, outputPath: string): Promise<void> {
  const response = await requestStream(url, 0);
  await pipeline(response, createWriteStream(outputPath));
}

async function requestStream(url: string, redirectCount: number): Promise<NodeJS.ReadableStream> {
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error("下载失败: 重定向次数过多");
  }

  const target = new URL(url);
  const client = target.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(
      target,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
          Accept: "*/*",
          Referer: `${target.origin}/`
        }
      },
      async (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location) {
          response.resume();
          try {
            const redirected = await requestStream(new URL(location, target).href, redirectCount + 1);
            resolve(redirected);
          } catch (error) {
            reject(error);
          }
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`下载失败: HTTP ${statusCode}`));
          return;
        }

        resolve(response);
      }
    );

    request.setTimeout(CONNECT_TIMEOUT_MS, () => {
      request.destroy(new Error(`下载超时: ${Math.round(CONNECT_TIMEOUT_MS / 1000)} 秒内未连上源站`));
    });

    request.on("error", (error) => {
      reject(normalizeDownloadError(error));
    });
  });
}

function normalizeDownloadError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes("ETIMEDOUT") || message.includes("connect ETIMEDOUT")) {
    return new Error("下载超时: 连接源站超时");
  }

  if (message.includes("ENOTFOUND")) {
    return new Error("下载失败: 找不到源站地址");
  }

  if (message.includes("ECONNRESET")) {
    return new Error("下载失败: 源站中途断开连接");
  }

  return error instanceof Error ? error : new Error(message);
}
