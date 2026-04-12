import type { BatchExportResult, BatchExportTask } from "../types.js";

export type BatchExportWorker = (task: BatchExportTask) => Promise<BatchExportResult>;

export async function processBatchExport(
  tasks: BatchExportTask[],
  worker: BatchExportWorker,
  concurrency = 5
): Promise<BatchExportResult[]> {
  if (tasks.length === 0) {
    return [];
  }

  const maxConcurrency = normalizeConcurrency(concurrency);
  const results = new Array<BatchExportResult>(tasks.length);
  let nextTaskIndex = 0;

  async function runWorkerLoop(): Promise<void> {
    while (nextTaskIndex < tasks.length) {
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      const task = tasks[taskIndex];
      if (!task) {
        continue;
      }

      try {
        results[taskIndex] = await worker(task);
      } catch (error) {
        results[taskIndex] = {
          taskId: task.taskId,
          videoIndex: task.videoIndex,
          coverIndex: task.coverIndex,
          src: task.videoSrc,
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  }

  const runners = Array.from(
    { length: Math.min(maxConcurrency, tasks.length) },
    () => runWorkerLoop()
  );
  await Promise.all(runners);
  return results;
}

function normalizeConcurrency(value: number): number {
  if (!Number.isFinite(value) || value < 1) {
    return 1;
  }
  return Math.floor(value);
}
