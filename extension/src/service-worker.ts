import type { TabVideoState, VideoCandidate } from "./types";
import { LOCAL_SERVER_BASE_URL, makeCandidate, mergeCandidates } from "./utils";

// MV3 的 service worker 负责跨页面和 side panel 的中转与缓存，
// 因为 side panel 不能直接看到内容页 DOM，所以需要它按 tab 保存采集结果。

const tabStateMap = new Map<number, TabVideoState>();

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
    sendResponse({
      ok: true,
      data: tabStateMap.get(tabId) ?? null
    });
    return true;
  }

  if (message?.type === "REQUEST_TAB_REFRESH") {
    const tabId = message.payload.tabId as number;
    triggerContentRefresh(tabId)
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

async function triggerContentRefresh(tabId: number): Promise<TabVideoState | null> {
  await chrome.tabs.sendMessage(tabId, { type: "REFRESH_VIDEO_DISCOVERY" });
  await delay(350);
  return tabStateMap.get(tabId) ?? null;
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

