import { makeCandidate } from "./utils";
import type { VideoCandidate } from "./types";

// MV3 下把页面采集逻辑放在 content script，是因为它最接近真实 DOM 和运行中的 video 元素，
// 能直接拿到 currentSrc、poster、duration 这些浏览器已经解析过的信息。

let sentUrls = new Set<string>();

async function collectAndSend(sourceType: "dom" | "mutation" | "performance"): Promise<void> {
  const candidates = (await collectCandidates(sourceType)).filter((item) => {
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

async function collectCandidates(sourceType: "dom" | "mutation" | "performance"): Promise<VideoCandidate[]> {
  const results = new Map<string, VideoCandidate>();

  const addVideoElement = async (video: HTMLVideoElement) => {
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

    const fallbackPoster = await resolvePoster(video);

    for (const src of sources) {
      results.set(
        src,
        makeCandidate({
          src,
          title: document.title,
          poster: video.poster || fallbackPoster,
          duration: Number.isFinite(video.duration) ? video.duration : null,
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          sourceType
        })
      );
    }
  };

  await Promise.all(
    [...document.querySelectorAll("video")].map((video) => addVideoElement(video as HTMLVideoElement))
  );

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
      void collectAndSend("mutation");
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
    void collectAndSend("dom");
    void collectAndSend("performance");
    sendResponse({ ok: true });
  }
});

void collectAndSend("dom");
setTimeout(() => void collectAndSend("performance"), 1200);
startObservers();

async function resolvePoster(video: HTMLVideoElement): Promise<string> {
  if (video.poster) {
    return video.poster;
  }

  const nearbyImage = findNearbyImage(video);
  if (nearbyImage) {
    return nearbyImage;
  }

  try {
    return await captureVideoFrame(video);
  } catch {
    return "";
  }
}

function findNearbyImage(video: HTMLVideoElement): string {
  const scope = video.closest("article, li, a, section, div") ?? video.parentElement;
  const image = scope?.querySelector("img[src]") as HTMLImageElement | null;
  return image?.src || "";
}

async function captureVideoFrame(video: HTMLVideoElement): Promise<string> {
  const readyVideo = await ensureVideoReady(video);
  if (!readyVideo.videoWidth || !readyVideo.videoHeight) {
    return "";
  }

  const canvas = document.createElement("canvas");
  canvas.width = readyVideo.videoWidth;
  canvas.height = readyVideo.videoHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }

  context.drawImage(readyVideo, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.78);
}

async function ensureVideoReady(video: HTMLVideoElement): Promise<HTMLVideoElement> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return video;
  }

  await new Promise<void>((resolve, reject) => {
    const onLoaded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("video preview unavailable"));
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", onLoaded);
      video.removeEventListener("error", onError);
    };

    video.addEventListener("loadeddata", onLoaded, { once: true });
    video.addEventListener("error", onError, { once: true });
    video.load();
  });

  return video;
}
