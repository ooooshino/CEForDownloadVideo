import { createWriteStream } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline } from "node:stream/promises";
import {
  DOWNLOAD_PROXY_ENABLED,
  DOWNLOAD_PROXY_HOST,
  DOWNLOAD_PROXY_PORT
} from "../config.js";
import type { ExportResultItem } from "../types.js";
import { logInfo } from "../utils/logger.js";

const CONNECT_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;
const MAX_RETRIES = 3;

export async function downloadToFile(url: string, outputPath: string): Promise<void> {
  logInfo("Downloading source video", {
    url,
    outputPath,
    proxyEnabled: DOWNLOAD_PROXY_ENABLED,
    proxyHost: DOWNLOAD_PROXY_ENABLED ? DOWNLOAD_PROXY_HOST : "",
    proxyPort: DOWNLOAD_PROXY_ENABLED ? DOWNLOAD_PROXY_PORT : 0
  });

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

  return new Promise((resolve, reject) => {
    void createRequest(target, async (response) => {
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
    })
      .then((request) => {
        request.setTimeout(CONNECT_TIMEOUT_MS, () => {
          request.destroy(new Error(`下载超时: ${Math.round(CONNECT_TIMEOUT_MS / 1000)} 秒内未连上源站`));
        });

        request.on("error", (error) => {
          reject(normalizeDownloadError(error));
        });
      })
      .catch((error) => {
        reject(normalizeDownloadError(error));
      });
  });
}

async function createRequest(
  target: URL,
  onResponse: (response: http.IncomingMessage) => void | Promise<void>
): Promise<http.ClientRequest> {
  if (!DOWNLOAD_PROXY_ENABLED) {
    return createDirectRequest(target, onResponse);
  }

  return target.protocol === "https:"
    ? createHttpsProxyRequest(target, onResponse)
    : createHttpProxyRequest(target, onResponse);
}

function createDirectRequest(
  target: URL,
  onResponse: (response: http.IncomingMessage) => void | Promise<void>
): http.ClientRequest {
  const client = target.protocol === "https:" ? https : http;
  return client.get(
    target,
    {
      headers: buildRequestHeaders(target)
    },
    onResponse
  );
}

function createHttpProxyRequest(
  target: URL,
  onResponse: (response: http.IncomingMessage) => void | Promise<void>
): http.ClientRequest {
  return http.get(
    {
      host: DOWNLOAD_PROXY_HOST,
      port: DOWNLOAD_PROXY_PORT,
      path: target.href,
      headers: {
        ...buildRequestHeaders(target),
        Host: target.host
      }
    },
    onResponse
  );
}

async function createHttpsProxyRequest(
  target: URL,
  onResponse: (response: http.IncomingMessage) => void | Promise<void>
): Promise<http.ClientRequest> {
  const socket = await createProxyTunnel(target);
  const request = https.get(
    {
      protocol: "https:",
      host: target.hostname,
      port: Number(target.port || 443),
      path: `${target.pathname}${target.search}`,
      headers: buildRequestHeaders(target),
      servername: target.hostname,
      createConnection: () => socket,
      agent: false
    },
    onResponse
  );

  request.on("close", () => {
    if (!socket.destroyed) {
      socket.destroy();
    }
  });

  return request;
}

async function createProxyTunnel(target: URL): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const tunnel = net.connect(DOWNLOAD_PROXY_PORT, DOWNLOAD_PROXY_HOST);

    tunnel.setTimeout(CONNECT_TIMEOUT_MS, () => {
      tunnel.destroy(new Error(proxyConnectTimeoutMessage(target)));
    });

    tunnel.once("error", reject);

    tunnel.once("connect", () => {
      const port = Number(target.port || 443);
      tunnel.write(
        `CONNECT ${target.hostname}:${port} HTTP/1.1\r\nHost: ${target.hostname}:${port}\r\nProxy-Connection: Keep-Alive\r\n\r\n`
      );
    });

    let buffer = Buffer.alloc(0);
    const handleData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      tunnel.off("data", handleData);

      const header = buffer.subarray(0, headerEnd).toString("utf8");
      const statusLine = header.split("\r\n")[0] || "";
      if (!statusLine.includes(" 200 ")) {
        tunnel.destroy();
        reject(new Error(`代理连接失败: ${statusLine || "CONNECT 响应异常"}`));
        return;
      }

      const remaining = buffer.subarray(headerEnd + 4);
      if (remaining.length > 0) {
        tunnel.unshift(remaining);
      }

      tunnel.setTimeout(0);
      resolve(tunnel);
    };

    tunnel.on("data", handleData);
  });
}

function buildRequestHeaders(target: URL): Record<string, string> {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36",
    Accept: "*/*",
    Referer: `${target.origin}/`
  };
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

  if (message.includes("ECONNREFUSED")) {
    return new Error(
      `下载失败: 无法连接代理 ${DOWNLOAD_PROXY_HOST}:${DOWNLOAD_PROXY_PORT}，请确认 Clash 已启动或调整代理配置`
    );
  }

  if (message.includes("代理连接失败")) {
    return new Error(`${message}，请检查 Clash 代理是否可用`);
  }

  return error instanceof Error ? error : new Error(message);
}

function proxyConnectTimeoutMessage(target: URL): string {
  return `下载超时: 连接代理 ${DOWNLOAD_PROXY_HOST}:${DOWNLOAD_PROXY_PORT} 超时，目标 ${target.hostname}`;
}
