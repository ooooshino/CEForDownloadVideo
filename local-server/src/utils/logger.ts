export function logInfo(message: string, extra?: unknown): void {
  console.log(`[info] ${message}`, extra ?? "");
}

export function logError(message: string, extra?: unknown): void {
  console.error(`[error] ${message}`, extra ?? "");
}

