import assert from "node:assert/strict";
import test from "node:test";
import type { TabVideoState } from "./types";
import {
  createFrozenSelectionSnapshot,
  createInitialCoverDrafts,
  mergeFrozenSelectionDraft
} from "./selection-storage";

function makeState(): TabVideoState {
  return {
    tabId: 9,
    pageUrl: "https://www.redgifs.com/watch/demo",
    pageTitle: "Demo page",
    updatedAt: Date.now(),
    videos: [
      {
        id: "a",
        src: "https://cdn.example.com/a.mp4",
        title: "A",
        poster: "",
        pageLink: "",
        duration: 10,
        width: 720,
        height: 1280,
        sourceType: "network",
        exportable: true,
        unsupportedReason: ""
      },
      {
        id: "b",
        src: "blob:https://www.redgifs.com/demo",
        title: "B",
        poster: "",
        pageLink: "",
        duration: 10,
        width: 720,
        height: 1280,
        sourceType: "dom",
        exportable: false,
        unsupportedReason: "blob 地址暂不支持导出"
      },
      {
        id: "c",
        src: "https://cdn.example.com/c.mp4",
        title: "C",
        poster: "",
        pageLink: "",
        duration: 12,
        width: 720,
        height: 1280,
        sourceType: "network",
        exportable: true,
        unsupportedReason: ""
      },
      {
        id: "d",
        src: "https://cdn.example.com/d.mp4",
        title: "D",
        poster: "",
        pageLink: "",
        duration: 12,
        width: 720,
        height: 1280,
        sourceType: "network",
        exportable: true,
        unsupportedReason: ""
      }
    ]
  };
}

test("creates a frozen snapshot from the current selected exportable videos", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "b"]);

  assert.ok(snapshot);
  assert.equal(snapshot.videos.length, 1);
  assert.equal(snapshot.videos[0]?.id, "a");
  assert.equal(snapshot.pageTitle, "Demo page");
});

test("returns null when nothing exportable is selected", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["b"]);
  assert.equal(snapshot, null);
});

test("keeps the frozen snapshot order stable after the source state mutates", () => {
  const state = makeState();
  const snapshot = createFrozenSelectionSnapshot(state, ["a", "c", "d"]);

  assert.ok(snapshot);
  assert.deepEqual(snapshot.videos.map((video) => video.id), ["a", "c", "d"]);

  state.videos.reverse();
  state.videos.push({
    id: "e",
    src: "https://cdn.example.com/e.mp4",
    title: "E",
    poster: "",
    pageLink: "",
    duration: 12,
    width: 720,
    height: 1280,
    sourceType: "network",
    exportable: true,
    unsupportedReason: ""
  });

  assert.deepEqual(snapshot.videos.map((video) => video.id), ["a", "c", "d"]);
});

test("freezes the snapshot wrapper and nested video items against direct mutation", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c"]);

  assert.ok(snapshot);
  assert.throws(() => {
    snapshot.pageTitle = "Mutated title";
  }, TypeError);
  assert.throws(() => {
    snapshot.videos.push({
      id: "x",
      src: "https://cdn.example.com/x.mp4",
      title: "X",
      poster: "",
      pageLink: "",
      duration: 8,
      width: 640,
      height: 480,
      sourceType: "network",
      exportable: true,
      unsupportedReason: ""
    });
  }, TypeError);
  assert.throws(() => {
    snapshot.videos[0]!.title = "Mutated item";
  }, TypeError);
  assert.equal(snapshot.pageTitle, "Demo page");
  assert.equal(snapshot.videos[0]?.title, "A");
  assert.equal(snapshot.videos.length, 2);
});

test("creates initial cover drafts in frozen snapshot order", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c", "d"]);

  assert.ok(snapshot);

  const drafts = createInitialCoverDrafts(snapshot);

  assert.deepEqual(
    drafts.map(({ index, name, from, to }) => [index, name, from, to]),
    [
      [1, "Cover 1", 1, 1],
      [2, "Cover 2", 2, 2],
      [3, "Cover 3", 3, 3]
    ]
  );
});

test("merges cover drafts without mutating the source drafts and keeps remaining identities stable", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c", "d"]);

  assert.ok(snapshot);

  const initialDrafts = createInitialCoverDrafts(snapshot);
  const mergedDrafts = mergeFrozenSelectionDraft(snapshot, [initialDrafts[0], initialDrafts[2]]);

  assert.notEqual(mergedDrafts, initialDrafts);
  assert.deepEqual(
    mergedDrafts.map(({ id, storageKey, index, name }) => [id, storageKey, index, name]),
    [
      [initialDrafts[0]?.id, initialDrafts[0]?.storageKey, 1, "Cover 1"],
      [initialDrafts[2]?.id, initialDrafts[2]?.storageKey, 2, "Cover 2"]
    ]
  );

  mergedDrafts[0]!.name = "Edited";
  assert.equal(initialDrafts[0]?.name, "Cover 1");
});

test("round-trips the frozen snapshot and draft state through JSON storage", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c", "d"]);

  assert.ok(snapshot);

  const initialDrafts = createInitialCoverDrafts(snapshot).filter((_, index) => index !== 1);
  const stored = JSON.stringify({
    snapshot,
    coverDrafts: initialDrafts
  });
  const parsed = JSON.parse(stored) as {
    snapshot: NonNullable<typeof snapshot>;
    coverDrafts: typeof initialDrafts;
  };

  const reloadedDrafts = mergeFrozenSelectionDraft(parsed.snapshot, parsed.coverDrafts);

  assert.deepEqual(parsed.snapshot.videos.map((video) => video.id), ["a", "c", "d"]);
  assert.deepEqual(
    reloadedDrafts.map(({ id, storageKey, index, name, from, to }) => [
      id,
      storageKey,
      index,
      name,
      from,
      to
    ]),
    [
      [initialDrafts[0]?.id, initialDrafts[0]?.storageKey, 1, "Cover 1", 1, 1],
      [initialDrafts[1]?.id, initialDrafts[1]?.storageKey, 2, "Cover 2", 3, 3]
    ]
  );
});

test("keeps an explicit empty cover draft array empty after reload and merge", () => {
  const snapshot = createFrozenSelectionSnapshot(makeState(), ["a", "c", "d"]);

  assert.ok(snapshot);

  const stored = JSON.stringify({
    snapshot,
    coverDrafts: [] as const
  });
  const parsed = JSON.parse(stored) as {
    snapshot: NonNullable<typeof snapshot>;
    coverDrafts: readonly [];
  };

  const reloadedDrafts = mergeFrozenSelectionDraft(parsed.snapshot, parsed.coverDrafts);

  assert.deepEqual(parsed.coverDrafts, []);
  assert.deepEqual(reloadedDrafts, []);
});
