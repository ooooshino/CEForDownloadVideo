import assert from "node:assert/strict";
import test from "node:test";
import type { TabVideoState } from "./types";
import { resolveRefreshFailureState } from "./service-worker-refresh";

function makeState(): TabVideoState {
  return {
    tabId: 1,
    pageUrl: "https://www.redgifs.com/explore/gifs/test",
    pageTitle: "test",
    updatedAt: 123,
    videos: [
      {
        id: "a",
        src: "https://cdn.example.com/a.mp4",
        title: "A",
        poster: "",
        pageLink: "",
        duration: 5,
        width: 720,
        height: 1280,
        sourceType: "network",
        exportable: true,
        unsupportedReason: ""
      }
    ]
  };
}

test("keeps previous state when refresh receiver does not exist", () => {
  const existing = makeState();
  const result = resolveRefreshFailureState(existing, new Error("Could not establish connection. Receiving end does not exist."));

  assert.equal(result, existing);
});

test("does not swallow non-connection errors", () => {
  const existing = makeState();
  const result = resolveRefreshFailureState(existing, new Error("boom"));

  assert.equal(result, null);
});
