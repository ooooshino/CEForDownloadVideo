import type { TabVideoState, VideoCandidate } from "./types";
import { LOCAL_SERVER_BASE_URL, makeCandidate, mergeCandidates } from "./utils";

// MV3 的 service worker 负责跨页面和 side panel 的中转与缓存，
// 因为 side panel 不能直接看到内容页 DOM，所以需要它按 tab 保存采集结果。

const tabStateMap = new Map<number, TabVideoState>();
let redgifsTokenCache: { token: string; expiresAt: number } | null = null;

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "PAGE_CONTEXT_UPDATED") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      ensureTabContext(tabId, message.payload.pageUrl, message.payload.pageTitle);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "REDGIFS_EXPLORE_ITEMS") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      syncRedgifsExploreItems(tabId, message.payload.pageUrl, message.payload.pageTitle, message.payload.items)
        .then((data) => sendResponse({ ok: true, data }))
        .catch((error: unknown) => sendResponse({ ok: false, error: toErrorMessage(error) }));
      return true;
    }
    sendResponse({ ok: false, error: "无法识别当前标签页" });
    return true;
  }

  if (message?.type === "VIDEO_CANDIDATES_FOUND") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      upsertTabVideos(tabId, message.payload.pageUrl, message.payload.pageTitle, message.payload.videos);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (message?.type === "GET_TAB_VIDEOS") {
    const tabId = message.payload.tabId as number;
    getTabState(tabId)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error: unknown) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  if (message?.type === "REQUEST_TAB_REFRESH") {
    const tabId = message.payload.tabId as number;
    triggerContentRefresh(tabId, Boolean(message.payload.force))
      .then((value) => sendResponse({ ok: true, data: value }))
      .catch((error: unknown) => sendResponse({ ok: false, error: toErrorMessage(error) }));
    return true;
  }

  return false;
});

// 同时观察 DOM、MutationObserver、performance 和 webRequest，
// 是为了覆盖“页面已有视频”“后插入视频”“浏览器资源记录”“网络层直接出现 mp4”这几类常见来源。
chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (details.tabId < 0 || !looksLikeVideo(details.url)) {
      return;
    }

    const existingTabState = tabStateMap.get(details.tabId);
    if (existingTabState?.pageUrl && isRedgifsExploreUrl(existingTabState.pageUrl)) {
      return;
    }

    const candidate = makeCandidate({
      src: details.url,
      title: "",
      sourceType: "network"
    });

    const tab = tabStateMap.get(details.tabId);
    const pageUrl = tab?.pageUrl ?? "";
    const pageTitle = tab?.pageTitle ?? "";
    upsertTabVideos(details.tabId, pageUrl, pageTitle, [candidate]);
  },
  {
    urls: [
      "https://www.xfree.com/*",
      "https://fyptt.to/*",
      "https://www.redgifs.com/*"
    ]
  }
);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStateMap.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    tabStateMap.delete(tabId);
  }
});

function upsertTabVideos(tabId: number, pageUrl: string, pageTitle: string, videos: VideoCandidate[]): void {
  const existing = tabStateMap.get(tabId);

  tabStateMap.set(tabId, {
    tabId,
    pageUrl: pageUrl || existing?.pageUrl || "",
    pageTitle: pageTitle || existing?.pageTitle || "",
    updatedAt: Date.now(),
    videos: mergeCandidates(existing?.videos ?? [], videos)
  });
}

function ensureTabContext(tabId: number, pageUrl: string, pageTitle: string): void {
  const existing = tabStateMap.get(tabId);
  tabStateMap.set(tabId, {
    tabId,
    pageUrl: pageUrl || existing?.pageUrl || "",
    pageTitle: pageTitle || existing?.pageTitle || "",
    updatedAt: existing?.updatedAt ?? Date.now(),
    videos: existing?.videos ?? []
  });
}

async function getTabState(tabId: number): Promise<TabVideoState | null> {
  const existing = tabStateMap.get(tabId);
  if (existing) {
    return existing;
  }

  const tab = await chrome.tabs.get(tabId);
  if (!tab.url) {
    return null;
  }

  if (isRedgifsExploreUrl(tab.url)) {
    ensureTabContext(tabId, tab.url, tab.title || "");
    await chrome.tabs.sendMessage(tabId, { type: "REFRESH_VIDEO_DISCOVERY" });
    await delay(700);
    return tabStateMap.get(tabId) ?? null;
  }

  ensureTabContext(tabId, tab.url, tab.title || "");
  return tabStateMap.get(tabId) ?? null;
}

async function triggerContentRefresh(tabId: number, force: boolean): Promise<TabVideoState | null> {
  const tab = await chrome.tabs.get(tabId);
  if (tab.url && isRedgifsExploreUrl(tab.url)) {
    if (force) {
      const existing = tabStateMap.get(tabId);
      if (existing) {
        existing.updatedAt = 0;
      }
    }
    await chrome.tabs.sendMessage(tabId, { type: "REFRESH_VIDEO_DISCOVERY" });
    await delay(700);
    return tabStateMap.get(tabId) ?? null;
  }

  await chrome.tabs.sendMessage(tabId, { type: "REFRESH_VIDEO_DISCOVERY" });
  await delay(350);
  return tabStateMap.get(tabId) ?? null;
}

async function syncRedgifsExploreItems(
  tabId: number,
  pageUrl: string,
  pageTitle: string,
  items: Array<{ id: string; pageLink: string }>
): Promise<TabVideoState | null> {
  const existing = tabStateMap.get(tabId);
  if (existing && Date.now() - existing.updatedAt < 500 && existing.videos.length >= items.length) {
    return existing;
  }

  const videos = await resolveRedgifsExploreItems(items);
  tabStateMap.set(tabId, {
    tabId,
    pageUrl,
    pageTitle: pageTitle || existing?.pageTitle || "",
    updatedAt: Date.now(),
    videos
  });

  return tabStateMap.get(tabId) ?? null;
}

async function resolveRedgifsExploreItems(
  items: Array<{ id: string; pageLink: string }>
): Promise<VideoCandidate[]> {
  const uniqueItems = dedupeRedgifsItems(items).slice(0, 120);
  if (uniqueItems.length === 0) {
    return [];
  }

  const token = await getRedgifsToken();
  const candidates = new Map<string, VideoCandidate>();
  const batches = chunk(uniqueItems, 8);

  for (const batch of batches) {
    const resolved = await Promise.all(batch.map((item) => fetchRedgifsGifById(item, token)));
    for (const candidate of resolved) {
      if (candidate) {
        candidates.set(candidate.pageLink || candidate.src, candidate);
      }
    }
  }

  return [...candidates.values()];
}

async function fetchRedgifsGifById(
  item: { id: string; pageLink: string },
  token: string
): Promise<VideoCandidate | null> {
  const response = await fetch(`https://api.redgifs.com/v2/gifs/${encodeURIComponent(item.id)}?views=yes&users=yes&niches=yes`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as {
    gif?: {
      id: string;
      duration?: number;
      width?: number;
      height?: number;
      urls?: {
        hd?: string;
        sd?: string;
        silent?: string;
        poster?: string;
        thumbnail?: string;
      };
    };
  };

  const gif = data.gif;
  const src = gif?.urls?.hd || gif?.urls?.sd || gif?.urls?.silent || "";
  if (!gif || !src) {
    return null;
  }

  return makeCandidate({
    src,
    title: `Redgifs | ${gif.id}`,
    poster: gif.urls?.poster || gif.urls?.thumbnail || "",
    pageLink: item.pageLink || `https://www.redgifs.com/watch/${gif.id}`,
    duration: typeof gif.duration === "number" ? gif.duration : null,
    width: typeof gif.width === "number" ? gif.width : null,
    height: typeof gif.height === "number" ? gif.height : null,
    sourceType: "network"
  });
}

async function getRedgifsToken(): Promise<string> {
  if (redgifsTokenCache && redgifsTokenCache.expiresAt > Date.now() + 30_000) {
    return redgifsTokenCache.token;
  }

  const response = await fetch("https://api.redgifs.com/v2/auth/temporary");
  if (!response.ok) {
    throw new Error(`Redgifs 鉴权失败：HTTP ${response.status}`);
  }

  const data = (await response.json()) as { token?: string };
  if (!data.token) {
    throw new Error("Redgifs 鉴权失败：没有拿到 token");
  }

  redgifsTokenCache = {
    token: data.token,
    expiresAt: parseJwtExpiry(data.token)
  };

  return data.token;
}

function parseJwtExpiry(token: string): number {
  try {
    const payload = token.split(".")[1];
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: number };
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : Date.now() + 5 * 60_000;
  } catch {
    return Date.now() + 5 * 60_000;
  }
}

function isRedgifsExploreUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "www.redgifs.com" && parsed.pathname.startsWith("/explore/gifs");
  } catch {
    return false;
  }
}

function dedupeRedgifsItems(items: Array<{ id: string; pageLink: string }>): Array<{ id: string; pageLink: string }> {
  const map = new Map<string, { id: string; pageLink: string }>();
  for (const item of items) {
    const id = item.id.trim();
    if (!id) {
      continue;
    }
    map.set(id.toLowerCase(), {
      id,
      pageLink: item.pageLink || `https://www.redgifs.com/watch/${id}`
    });
  }
  return [...map.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

function looksLikeVideo(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.includes(".mp4") || lower.includes(".m3u8") || lower.includes(".mpd");
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void LOCAL_SERVER_BASE_URL;
