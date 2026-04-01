import { createCandidateKey, makeCandidate } from "./utils";
import type { VideoCandidate } from "./types";

// MV3 下把页面采集逻辑放在 content script，是因为它最接近真实 DOM 和运行中的 video 元素，
// 能直接拿到 currentSrc、poster、duration 这些浏览器已经解析过的信息。

let sentUrls = new Set<string>();
let hasScannedStaticSources = false;
let redgifsHoverSweepStarted = false;
const redgifsExplorePage = isRedgifsExplorePage();
let redgifsExploreSyncTimer: number | null = null;

async function collectAndSend(sourceType: "dom" | "mutation" | "performance"): Promise<void> {
  const candidates = (await collectCandidates(sourceType)).filter((item) => {
    const key = createCandidateKey(item.src);
    if (!item.src || sentUrls.has(key)) {
      return false;
    }
    sentUrls.add(key);
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
    const pageLink = resolveNearestPageLink(video);

    for (const src of sources) {
      results.set(
        src,
        makeCandidate({
          src,
          title: document.title,
          poster: video.poster || fallbackPoster,
          pageLink,
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
    const pageLink = resolveNearestPageLink(source as HTMLSourceElement);
    results.set(
      src,
      makeCandidate({
        src,
        title: document.title,
        pageLink,
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
          pageLink: resolveNearestPageLink(document.body),
          sourceType
        })
      );
    }
  }

  if (sourceType !== "mutation" || !hasScannedStaticSources) {
    for (const candidate of collectMetaCandidates(sourceType)) {
      results.set(candidate.src, candidate);
    }

    for (const candidate of collectScriptUrlCandidates(sourceType)) {
      results.set(candidate.src, candidate);
    }

    hasScannedStaticSources = true;
  }

  return [...results.values()];
}

function looksLikeVideo(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes(".mp4") || lower.includes(".m3u8") || lower.includes(".mpd") || lower.startsWith("blob:");
}

function startObservers(): void {
  if (redgifsExplorePage) {
    startRedgifsExploreObserver();
    return;
  }

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

  let hoverTimer: number | null = null;
  document.addEventListener(
    "pointerover",
    (event) => {
      const target = event.target as Element | null;
      if (!target?.closest("a, video, [role='link'], figure, article")) {
        return;
      }
      if (hoverTimer !== null) {
        window.clearTimeout(hoverTimer);
      }
      hoverTimer = window.setTimeout(() => {
        void collectAndSend("mutation");
        void collectAndSend("performance");
      }, 320);
    },
    { passive: true }
  );

  if ("PerformanceObserver" in window) {
    const performanceObserver = new PerformanceObserver((list) => {
      let found = false;
      for (const entry of list.getEntries()) {
        if (looksLikeVideo(entry.name)) {
          found = true;
          break;
        }
      }
      if (found) {
        void collectAndSend("performance");
      }
    });

    try {
      performanceObserver.observe({ entryTypes: ["resource"] });
    } catch {
      // 某些页面环境不支持持续监听资源条目，忽略即可。
    }
  }

  if (isRedgifsExplorePage() && !redgifsHoverSweepStarted) {
    redgifsHoverSweepStarted = true;
    startRedgifsHoverSweep();
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "REFRESH_VIDEO_DISCOVERY") {
    if (redgifsExplorePage) {
      sendPageContext();
      queueRedgifsExploreSync();
      sendResponse({ ok: true });
      return true;
    }

    sentUrls = new Set();
    hasScannedStaticSources = false;
    void collectAndSend("dom");
    void collectAndSend("performance");
    sendResponse({ ok: true });
  }
});

if (redgifsExplorePage) {
  sendPageContext();
  queueRedgifsExploreSync();
  startObservers();
} else {
  void collectAndSend("dom");
  setTimeout(() => void collectAndSend("performance"), 1200);
  for (const delay of [2500, 5000, 8000]) {
    setTimeout(() => {
      void collectAndSend("dom");
      void collectAndSend("performance");
    }, delay);
  }
  startObservers();
}

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

function collectMetaCandidates(sourceType: "dom" | "performance"): VideoCandidate[] {
  const values = new Set<string>();
  const selectors = [
    "meta[property='og:video']",
    "meta[property='og:video:url']",
    "meta[name='twitter:player:stream']",
    "meta[itemprop='contentUrl']",
    "link[rel='preload'][as='video']"
  ];

  for (const selector of selectors) {
    for (const node of document.querySelectorAll(selector)) {
      const value = (node.getAttribute("content") || node.getAttribute("href") || "").trim();
      if (looksLikeVideo(value)) {
        values.add(new URL(value, location.href).href);
      }
    }
  }

  const poster =
    document.querySelector<HTMLMetaElement>("meta[property='og:image']")?.content ||
    document.querySelector<HTMLMetaElement>("meta[name='twitter:image']")?.content ||
    "";

  return [...values].map((src) =>
    makeCandidate({
      src,
      title: document.title,
      poster,
      pageLink: resolveNearestPageLink(document.body),
      sourceType
    })
  );
}

function collectScriptUrlCandidates(sourceType: "dom" | "performance"): VideoCandidate[] {
  const candidates = new Map<string, VideoCandidate>();
  const urlPattern =
    /https?:\\?\/\\?\/[^"'`\s<>]+?\.(?:mp4|webm|m3u8|mpd)(?:\?[^"'`\s<>]*)?/gi;
  const poster =
    document.querySelector<HTMLMetaElement>("meta[property='og:image']")?.content ||
    document.querySelector<HTMLMetaElement>("meta[name='twitter:image']")?.content ||
    "";

  for (const script of document.scripts) {
    const text = script.textContent;
    if (!text) {
      continue;
    }

    const matches = text.match(urlPattern) ?? [];
    for (const match of matches) {
      const normalized = normalizeScriptUrl(match);
      if (!looksLikeVideo(normalized)) {
        continue;
      }
      candidates.set(
        normalized,
        makeCandidate({
          src: normalized,
          title: document.title,
          poster,
          pageLink: extractLinkFromScript(text),
          sourceType
        })
      );
    }
  }

  return [...candidates.values()];
}

function normalizeScriptUrl(value: string): string {
  return value.replaceAll("\\/", "/");
}

function resolveNearestPageLink(node: Element | null): string {
  const anchor =
    node?.closest("a[href]") ||
    node?.querySelector("a[href]") ||
    document.querySelector("main a[href*='/watch/'], main a[href*='/gifs/'], article a[href], a[href]");

  if (!(anchor instanceof HTMLAnchorElement)) {
    return "";
  }

  const href = anchor.href || anchor.getAttribute("href") || "";
  if (!href) {
    return "";
  }

  try {
    return new URL(href, location.href).href;
  } catch {
    return href;
  }
}

function extractLinkFromScript(text: string): string {
  const linkMatch = text.match(/https?:\\?\/\\?\/[^"'`\s<>]+(?:\/watch\/|\/gifs\/)[^"'`\s<>]+/i);
  if (!linkMatch) {
    return "";
  }
  return normalizeScriptUrl(linkMatch[0]);
}

function isRedgifsExplorePage(): boolean {
  return location.hostname === "www.redgifs.com" && location.pathname.startsWith("/explore/");
}

function sendPageContext(): void {
  chrome.runtime.sendMessage({
    type: "PAGE_CONTEXT_UPDATED",
    payload: {
      pageUrl: location.href,
      pageTitle: document.title
    }
  });
}

function startRedgifsExploreObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.matches("[data-feed-item-id], a[href*='/watch/']") || node.querySelector("[data-feed-item-id], a[href*='/watch/']")) {
          queueRedgifsExploreSync();
          return;
        }
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener(
    "scroll",
    () => {
      queueRedgifsExploreSync(240);
    },
    { passive: true }
  );
}

function queueRedgifsExploreSync(delayMs = 120): void {
  if (redgifsExploreSyncTimer !== null) {
    window.clearTimeout(redgifsExploreSyncTimer);
  }

  redgifsExploreSyncTimer = window.setTimeout(() => {
    redgifsExploreSyncTimer = null;
    sendRedgifsExploreItems();
  }, delayMs);
}

function sendRedgifsExploreItems(): void {
  const items = collectRedgifsExploreItems();
  chrome.runtime.sendMessage({
    type: "REDGIFS_EXPLORE_ITEMS",
    payload: {
      pageUrl: location.href,
      pageTitle: document.title,
      items
    }
  });
}

function collectRedgifsExploreItems(): Array<{ id: string; pageLink: string }> {
  const items = new Map<string, { id: string; pageLink: string }>();

  for (const element of document.querySelectorAll<HTMLElement>("[data-feed-item-id]")) {
    const id = (element.dataset.feedItemId || "").trim();
    if (!id) {
      continue;
    }

    const link = resolveNearestWatchLink(element, id);
    items.set(id.toLowerCase(), { id, pageLink: link });
  }

  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href*='/watch/']")) {
    const href = anchor.getAttribute("href") || anchor.href || "";
    const id = extractRedgifsIdFromLink(href);
    if (!id) {
      continue;
    }

    const pageLink = resolveNearestWatchLink(anchor, id);
    items.set(id.toLowerCase(), { id, pageLink });
  }

  return [...items.values()];
}

function resolveNearestWatchLink(node: Element, id: string): string {
  const anchor =
    node.closest("a[href*='/watch/']") ||
    node.querySelector("a[href*='/watch/']") ||
    document.querySelector(`a[href*="/watch/${CSS.escape(id)}"]`);

  if (anchor instanceof HTMLAnchorElement) {
    try {
      return new URL(anchor.getAttribute("href") || anchor.href, location.href).href;
    } catch {
      return anchor.href || `https://www.redgifs.com/watch/${id}`;
    }
  }

  return `https://www.redgifs.com/watch/${id}`;
}

function extractRedgifsIdFromLink(value: string): string {
  if (!value) {
    return "";
  }

  const match = value.match(/\/watch\/([^/?#]+)/i);
  return match?.[1] ?? "";
}

function startRedgifsHoverSweep(): void {
  const runSweep = async () => {
    const cards = findRedgifsHoverTargets();
    for (const card of cards) {
      triggerSyntheticHover(card);
      await delay(180);
      void collectAndSend("mutation");
      void collectAndSend("performance");
    }
  };

  void runSweep();
  for (const delayMs of [1500, 3500, 6000]) {
    window.setTimeout(() => {
      void runSweep();
    }, delayMs);
  }
}

function findRedgifsHoverTargets(): HTMLElement[] {
  const selectors = [
    "a[href*='/watch/']",
    "a[href*='/gifs/']",
    "main a[href^='/']",
    "[data-testid*='gif'] a",
    "article a"
  ];

  const unique = new Set<HTMLElement>();
  for (const selector of selectors) {
    for (const element of document.querySelectorAll(selector)) {
      if (element instanceof HTMLElement) {
        unique.add(element);
      }
    }
  }

  return [...unique].slice(0, 24);
}

function triggerSyntheticHover(element: HTMLElement): void {
  const events = ["pointerover", "pointerenter", "mouseover", "mouseenter", "mousemove"];
  for (const type of events) {
    element.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        view: window
      })
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
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
