import { makeCandidate } from "./utils";
import type { VideoCandidate } from "./types";

// MV3 下把页面采集逻辑放在 content script，是因为它最接近真实 DOM 和运行中的 video 元素，
// 能直接拿到 currentSrc、poster、duration 这些浏览器已经解析过的信息。

let sentUrls = new Set<string>();

function collectAndSend(sourceType: "dom" | "mutation" | "performance"): void {
  const candidates = collectCandidates(sourceType).filter((item) => {
    if (!item.src || sentUrls.has(item.src)) {
      return false;
    }
    sentUrls.add(item.src);
    return true;
  });

  if (candidates.length === 0) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "VIDEO_CANDIDATES_FOUND",
    payload: {
      pageUrl: location.href,
      pageTitle: document.title,
      videos: candidates
    }
  });
}

function collectCandidates(sourceType: "dom" | "mutation" | "performance"): VideoCandidate[] {
  const results = new Map<string, VideoCandidate>();

  const addVideoElement = (video: HTMLVideoElement) => {
    const sources = new Set<string>();
    if (video.currentSrc) {
      sources.add(video.currentSrc);
    }
    if (video.src) {
      sources.add(video.src);
    }
    for (const source of video.querySelectorAll("source")) {
      if (source.src) {
        sources.add(source.src);
      }
    }

    for (const src of sources) {
      results.set(
        src,
        makeCandidate({
          src,
          title: document.title,
          poster: video.poster || "",
          duration: Number.isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          sourceType
        })
      );
    }
  };

  for (const video of document.querySelectorAll("video")) {
    addVideoElement(video as HTMLVideoElement);
  }

  for (const source of document.querySelectorAll("source[src]")) {
    const src = (source as HTMLSourceElement).src;
    if (!src) {
      continue;
    }
    results.set(
      src,
      makeCandidate({
        src,
        title: document.title,
        sourceType
      })
    );
  }

  if (sourceType === "performance") {
    for (const entry of performance.getEntriesByType("resource")) {
      const url = entry.name;
      if (!looksLikeVideo(url)) {
        continue;
      }
      results.set(
        url,
        makeCandidate({
          src: url,
          title: document.title,
          sourceType
        })
      );
    }
  }

  return [...results.values()];
}

function looksLikeVideo(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes(".mp4") || lower.includes(".m3u8") || lower.includes(".mpd") || lower.startsWith("blob:");
}

function startObservers(): void {
  const observer = new MutationObserver((mutations) => {
    let found = false;
    for (const mutation of mutations) {
      if (mutation.type !== "childList") {
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.matches("video, source") || node.querySelector("video, source")) {
          found = true;
          break;
        }
      }
      if (found) {
        break;
      }
    }

    if (found) {
      collectAndSend("mutation");
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REFRESH_VIDEO_DISCOVERY") {
    sentUrls = new Set();
    collectAndSend("dom");
    collectAndSend("performance");
    sendResponse({ ok: true });
  }
});

collectAndSend("dom");
setTimeout(() => collectAndSend("performance"), 1200);
startObservers();

