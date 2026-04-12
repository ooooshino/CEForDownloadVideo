import assert from "node:assert/strict";
import test from "node:test";
import type { TabVideoState } from "./types";
import { resolveRefreshState } from "./sidepanel-state";

function makeState(videoIds: string[]): TabVideoState {
  return {
    tabId: 1,
    pageUrl: "https://www.redgifs.com/watch/demo",
    pageTitle: "demo",
    updatedAt: Date.now(),
    videos: videoIds.map((id) => ({
      id,
      src: `https://cdn.example.com/${id}.mp4`,
      title: id,
      poster: "",
      pageLink: "",
      duration: 12,
      width: 720,
      height: 1280,
      sourceType: "network",
      exportable: true,
      unsupportedReason: ""
    }))
  };
}

test("keeps the existing list during silent refresh when new result is temporarily empty", () => {
  const existing = makeState(["a", "b"]);
  const incoming = makeState([]);

  const result = resolveRefreshState({
    previousState: existing,
    incomingState: incoming,
    silent: true,
    hasPendingSelection: true,
    isExporting: false
  });

  assert.equal(result.videos.length, 2);
  assert.deepEqual(
    result.videos.map((item) => item.id),
    ["a", "b"]
  );
});

test("accepts an empty result on manual refresh", () => {
  const existing = makeState(["a", "b"]);
  const incoming = makeState([]);

  const result = resolveRefreshState({
    previousState: existing,
    incomingState: incoming,
    silent: false,
    hasPendingSelection: true,
    isExporting: false
  });

  assert.equal(result.videos.length, 0);
});

test("keeps the existing list while export is in progress", () => {
  const existing = makeState(["a"]);
  const incoming = makeState([]);

  const result = resolveRefreshState({
    previousState: existing,
    incomingState: incoming,
    silent: true,
    hasPendingSelection: false,
    isExporting: true
  });

  assert.equal(result.videos.length, 1);
  assert.equal(result.videos[0]?.id, "a");
});
