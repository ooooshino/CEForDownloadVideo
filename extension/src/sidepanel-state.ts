import type { TabVideoState } from "./types";

interface ResolveRefreshStateInput {
  previousState: TabVideoState | null;
  incomingState: TabVideoState | null;
  silent: boolean;
  hasPendingSelection: boolean;
  isExporting: boolean;
}

export function resolveRefreshState(input: ResolveRefreshStateInput): TabVideoState | null {
  const { previousState, incomingState, silent, hasPendingSelection, isExporting } = input;

  if (!previousState || !incomingState) {
    return incomingState;
  }

  if (incomingState.videos.length > 0) {
    return incomingState;
  }

  if (!previousState.videos.length) {
    return incomingState;
  }

  if (!silent) {
    return incomingState;
  }

  if (!hasPendingSelection && !isExporting) {
    return incomingState;
  }

  return {
    ...incomingState,
    videos: previousState.videos
  };
}
