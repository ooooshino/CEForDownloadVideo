import test from "node:test";
import assert from "node:assert/strict";
import { processBatchExport } from "./batch-export.js";
import type { BatchExportTask } from "../types.js";

function createTasks(count: number): BatchExportTask[] {
  return Array.from({ length: count }, (_, index) => ({
    taskId: `task-${index + 1}`,
    videoIndex: index,
    videoSrc: `https://example.com/video-${index + 1}.mp4`,
    coverIndex: index % 2,
    coverUploadField: `cover-${(index % 2) + 1}`
  }));
}

test("caps active batch work at 3", async () => {
  const tasks = createTasks(5);
  let active = 0;
  let maxConcurrent = 0;

  const results = await processBatchExport(
    tasks,
    async (task) => {
      active += 1;
      maxConcurrent = Math.max(maxConcurrent, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return {
        taskId: task.taskId,
        videoIndex: task.videoIndex,
        coverIndex: task.coverIndex,
        src: task.videoSrc,
        success: true
      };
    },
    3
  );

  assert.equal(maxConcurrent, 3);
  assert.equal(results.length, 5);
  assert.deepEqual(
    results.map((item) => item.taskId),
    tasks.map((item) => item.taskId)
  );
});

test("uses default concurrency 5 when not provided", async () => {
  const tasks = createTasks(8);
  let active = 0;
  let maxConcurrent = 0;

  await processBatchExport(tasks, async (task) => {
    active += 1;
    maxConcurrent = Math.max(maxConcurrent, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active -= 1;
    return {
      taskId: task.taskId,
      videoIndex: task.videoIndex,
      coverIndex: task.coverIndex,
      src: task.videoSrc,
      success: true
    };
  });

  assert.equal(maxConcurrent, 5);
});

test("one task rejection does not abort the whole batch", async () => {
  const tasks = createTasks(4);
  const results = await processBatchExport(tasks, async (task) => {
    if (task.taskId === "task-2") {
      throw new Error("boom");
    }
    return {
      taskId: task.taskId,
      videoIndex: task.videoIndex,
      coverIndex: task.coverIndex,
      src: task.videoSrc,
      success: true
    };
  });

  assert.equal(results.length, 4);
  assert.equal(results[1]?.success, false);
  assert.match(results[1]?.error ?? "", /boom/);
  assert.equal(results[0]?.success, true);
  assert.equal(results[2]?.success, true);
  assert.equal(results[3]?.success, true);
});

test("same video with two covers produces two distinct results", async () => {
  const tasks: BatchExportTask[] = [
    {
      taskId: "task-a",
      videoIndex: 0,
      videoSrc: "https://example.com/same.mp4",
      coverIndex: 0,
      coverUploadField: "cover-1"
    },
    {
      taskId: "task-b",
      videoIndex: 0,
      videoSrc: "https://example.com/same.mp4",
      coverIndex: 1,
      coverUploadField: "cover-2"
    }
  ];

  const results = await processBatchExport(tasks, async (task) => ({
    taskId: task.taskId,
    videoIndex: task.videoIndex,
    coverIndex: task.coverIndex,
    src: task.videoSrc,
    success: true,
    outputPath: `/tmp/out-video-${task.videoIndex + 1}-cover-${task.coverIndex + 1}.mp4`
  }));

  assert.equal(results.length, 2);
  assert.notEqual(results[0]?.taskId, results[1]?.taskId);
  assert.notEqual(results[0]?.coverIndex, results[1]?.coverIndex);
  assert.notEqual(results[0]?.outputPath, results[1]?.outputPath);
});
