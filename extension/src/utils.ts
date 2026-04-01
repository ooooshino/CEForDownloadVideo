import type { VideoCandidate, VideoSourceType } from "./types";

export const LOCAL_SERVER_BASE_URL = "http://127.0.0.1:37891";

export function normalizeVideoUrl(value: string): string {
  return value.trim();
}

export function inferExportability(src: string): Pick<VideoCandidate, "exportable" | "unsupportedReason"> {
  const lower = src.toLowerCase();

  if (lower.startsWith("blob:")) {
    return { exportable: false, unsupportedReason: "blob 地址暂不支持导出" };
  }

  if (lower.includes(".m3u8")) {
    return { exportable: false, unsupportedReason: "m3u8 暂不支持导出" };
  }

  if (lower.includes(".mpd")) {
    return { exportable: false, unsupportedReason: "dash 暂不支持导出" };
  }

  if (lower.includes(".mp4")) {
    return { exportable: true, unsupportedReason: "" };
  }

  return { exportable: false, unsupportedReason: "当前只支持 mp4 导出" };
}

export function createCandidateId(src: string): string {
  return `video_${simpleHash(normalizeVideoUrl(src))}`;
}

export function mergeCandidates(existing: VideoCandidate[], incoming: VideoCandidate[]): VideoCandidate[] {
  const map = new Map<string, VideoCandidate>();

  for (const item of [...existing, ...incoming]) {
    const key = normalizeVideoUrl(item.src);
    const previous = map.get(key);
    if (!previous) {
      map.set(key, item);
      continue;
    }

    map.set(key, {
      ...previous,
      ...item,
      title: item.title || previous.title,
      poster: item.poster || previous.poster,
      duration: item.duration ?? previous.duration,
      width: item.width ?? previous.width,
      height: item.height ?? previous.height,
      exportable: previous.exportable || item.exportable,
      unsupportedReason: previous.exportable ? previous.unsupportedReason : item.unsupportedReason || previous.unsupportedReason
    });
  }

  return [...map.values()].sort(sortCandidates);
}

export function makeCandidate(input: {
  src: string;
  title?: string;
  poster?: string;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  sourceType: VideoSourceType;
}): VideoCandidate {
  const src = normalizeVideoUrl(input.src);
  const support = inferExportability(src);

  return {
    id: createCandidateId(src),
    src,
    title: input.title ?? "",
    poster: input.poster ?? "",
    duration: input.duration ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    sourceType: input.sourceType,
    exportable: support.exportable,
    unsupportedReason: support.unsupportedReason
  };
}

function sortCandidates(a: VideoCandidate, b: VideoCandidate): number {
  const score = (candidate: VideoCandidate) => {
    if (candidate.exportable) {
      return 2;
    }
    if (candidate.src.startsWith("blob:")) {
      return 1;
    }
    return 0;
  };

  return score(b) - score(a) || a.src.localeCompare(b.src);
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

