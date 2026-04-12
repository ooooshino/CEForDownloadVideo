import type { TabVideoState } from "./types";

const RECEIVER_MISSING_PATTERNS = [
  "Could not establish connection. Receiving end does not exist.",
  "The message port closed before a response was received."
];

export function resolveRefreshFailureState(
  existingState: TabVideoState | undefined,
  error: unknown
): TabVideoState | null {
  const message = error instanceof Error ? error.message : String(error);
  if (!existingState) {
    return null;
  }

  if (RECEIVER_MISSING_PATTERNS.some((pattern) => message.includes(pattern))) {
    return existingState;
  }

  return null;
}
