import type { FrozenCoverDraft, FrozenExportTask } from "./types";

export interface CoverRange {
  from: number;
  to: number;
}

export interface RangeValidationIssue {
  index: number;
  from: number;
  to: number;
  reason: string;
}

export interface RangeValidationResult {
  isValid: boolean;
  invalidRanges: RangeValidationIssue[];
  uncoveredIndices: number[];
}

export interface BuildAutomaticRangesOptions {
  videoCount: number;
  coverCount: number;
}

export function buildAutomaticRanges(options: BuildAutomaticRangesOptions): CoverRange[] {
  const { videoCount, coverCount } = options;

  if (videoCount <= 0 || coverCount <= 0) {
    return [];
  }

  const activeCoverCount = Math.min(videoCount, coverCount);
  const baseSize = Math.floor(videoCount / activeCoverCount);
  const remainder = videoCount % activeCoverCount;
  const ranges: CoverRange[] = [];
  let from = 1;

  for (let index = 0; index < activeCoverCount; index += 1) {
    const size = baseSize + (index < remainder ? 1 : 0);
    const to = Math.min(videoCount, from + size - 1);
    ranges.push({ from, to });
    from = to + 1;
  }

  return ranges;
}

export function validateCoverRanges(videoCount: number, ranges: readonly CoverRange[]): RangeValidationResult {
  const invalidRanges: RangeValidationIssue[] = [];
  const covered = new Set<number>();

  if (!Number.isInteger(videoCount) || videoCount < 0) {
    invalidRanges.push({
      index: -1,
      from: videoCount,
      to: videoCount,
      reason: "video count must be a non-negative integer"
    });
  }

  ranges.forEach((range, index) => {
    const { from, to } = range;

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      invalidRanges.push({
        index,
        from,
        to,
        reason: "range bounds must be integers"
      });
      return;
    }

    if (from > to) {
      invalidRanges.push({
        index,
        from,
        to,
        reason: "from must be <= to"
      });
      return;
    }

    if (from < 1 || to < 1) {
      invalidRanges.push({
        index,
        from,
        to,
        reason: "range bounds must start at 1"
      });
      return;
    }

    if (videoCount > 0 && to > videoCount) {
      invalidRanges.push({
        index,
        from,
        to,
        reason: "to must be within the video count"
      });
      return;
    }

    for (let videoIndex = from; videoIndex <= to; videoIndex += 1) {
      covered.add(videoIndex);
    }
  });

  const uncoveredIndices: number[] = [];
  for (let videoIndex = 1; videoIndex <= videoCount; videoIndex += 1) {
    if (!covered.has(videoIndex)) {
      uncoveredIndices.push(videoIndex);
    }
  }

  return {
    isValid: invalidRanges.length === 0,
    invalidRanges,
    uncoveredIndices
  };
}

export function expandFrozenTasks(
  videoSrcs: readonly string[],
  covers: readonly FrozenCoverDraft[]
): { tasks: FrozenExportTask[]; uncoveredIndices: number[] } {
  const tasks: FrozenExportTask[] = [];
  const covered = new Set<number>();

  for (let videoIndex = 1; videoIndex <= videoSrcs.length; videoIndex += 1) {
    const videoSrc = videoSrcs[videoIndex - 1];
    if (!videoSrc) {
      continue;
    }

    for (const cover of covers) {
      if (videoIndex < cover.from || videoIndex > cover.to) {
        continue;
      }

      covered.add(videoIndex);
      tasks.push({
        taskId: `${cover.id}:${videoIndex}`,
        videoIndex,
        videoSrc,
        coverIndex: cover.index,
        coverStorageKey: cover.storageKey
      });
    }
  }

  const uncoveredIndices: number[] = [];
  for (let videoIndex = 1; videoIndex <= videoSrcs.length; videoIndex += 1) {
    if (!covered.has(videoIndex)) {
      uncoveredIndices.push(videoIndex);
    }
  }

  return {
    tasks,
    uncoveredIndices
  };
}
