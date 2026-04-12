import assert from "node:assert/strict";
import test from "node:test";
import { buildAutomaticRanges, expandFrozenTasks, validateCoverRanges } from "./selection-cover-plan";

test("auto distributes videos evenly across covers", () => {
  const ranges = buildAutomaticRanges({ videoCount: 10, coverCount: 3 });

  assert.deepEqual(
    ranges.map(({ from, to }) => [from, to]),
    [
      [1, 4],
      [5, 7],
      [8, 10]
    ]
  );
});

test("auto distributes without duplicating videos when there are more covers than videos", () => {
  const ranges = buildAutomaticRanges({ videoCount: 3, coverCount: 5 });

  assert.deepEqual(
    ranges.map(({ from, to }) => [from, to]),
    [
      [1, 1],
      [2, 2],
      [3, 3]
    ]
  );
});

test("expands overlapping cover ranges into duplicate tasks", () => {
  const result = expandFrozenTasks(["v1", "v2", "v3", "v4", "v5"], [
    { id: "cover-1", index: 1, name: "Cover 1", storageKey: "cover-1", from: 1, to: 3 },
    { id: "cover-2", index: 2, name: "Cover 2", storageKey: "cover-2", from: 3, to: 5 }
  ]);

  assert.equal(result.tasks.length, 6);
  assert.deepEqual(
    result.tasks.filter((item) => item.videoIndex === 3).map((item) => item.coverIndex),
    [1, 2]
  );
  assert.deepEqual(result.uncoveredIndices, []);
});

test("reports uncovered videos when no cover matches them", () => {
  const result = expandFrozenTasks(["v1", "v2", "v3", "v4"], [
    { id: "cover-1", index: 1, name: "Cover 1", storageKey: "cover-1", from: 1, to: 1 },
    { id: "cover-2", index: 2, name: "Cover 2", storageKey: "cover-2", from: 3, to: 3 }
  ]);

  assert.deepEqual(result.uncoveredIndices, [2, 4]);
});

test("rejects invalid from/to ranges", () => {
  const validation = validateCoverRanges(4, [
    { from: 0, to: 2 },
    { from: 3, to: 2 },
    { from: 1, to: 5 }
  ]);

  assert.equal(validation.isValid, false);
  assert.deepEqual(
    validation.invalidRanges.map(({ from, to, reason }) => [from, to, reason]),
    [
      [0, 2, "range bounds must start at 1"],
      [3, 2, "from must be <= to"],
      [1, 5, "to must be within the video count"]
    ]
  );
});
