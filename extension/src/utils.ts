import type { VideoCandidate, VideoSourceType } from "./types";

export const LOCAL_SERVER_BASE_URL = "http://127.0.0.1:37891";

export function normalizeVideoUrl(value: string): string {
  return value.trim();
}

export function createCandidateKey(src: string): string {
  const normalized = normalizeVideoUrl(src);

  if (normalized.startsWith("blob:")) {
    return normalized;
  }

  try {
    const url = new URL(normalized);
    const pathname = url.pathname
      .replace(/\/+/g, "/")
      .replace(/-(?:mobile|small|medium|large|sd|hd|hq)(?=\.[a-z0-9]+$)/i, "")
      .replace(/(?:^|\/)(?:thumbnail|thumb|poster)(?=[-_./])/i, "/preview");

    return `${url.hostname}${pathname}`.toLowerCase();
  } catch {
    return normalized.toLowerCase();
  }
}

function normalizeAssetUrl(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value, "https://placeholder.local");
    return `${url.hostname}${url.pathname}`.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function normalizePageLink(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`.replace(/\/+$/, "").toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

export function createMergeKey(candidate: Pick<VideoCandidate, "src" | "poster" | "pageLink">): string {
  if (!isRedgifsCandidate(candidate)) {
    return `src:${createCandidateKey(candidate.src)}`;
  }

  const pageLink = normalizePageLink(candidate.pageLink);
  if (pageLink) {
    return `page:${pageLink}`;
  }

  const poster = normalizeAssetUrl(candidate.poster);
  if (poster) {
    return `poster:${poster}`;
  }

  return `src:${createCandidateKey(candidate.src)}`;
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
  const existingByKey = new Map(existing.map((item) => [createMergeKey(item), item]));
  const incomingByKey = new Map<string, VideoCandidate>();

  for (const item of incoming) {
    const key = createMergeKey(item);
    const previous = incomingByKey.get(key) ?? existingByKey.get(key);
    if (!previous) {
      incomingByKey.set(key, item);
      continue;
    }

    incomingByKey.set(key, {
      ...previous,
      ...item,
      title: item.title || previous.title,
      poster: item.poster || previous.poster,
      pageLink: item.pageLink || previous.pageLink,
      duration: item.duration ?? previous.duration,
      width: item.width ?? previous.width,
      height: item.height ?? previous.height,
      src: chooseBetterSource(previous.src, item.src),
      exportable: previous.exportable || item.exportable,
      unsupportedReason: previous.exportable ? previous.unsupportedReason : item.unsupportedReason || previous.unsupportedReason
    });
  }

  const newItems = [...incomingByKey.entries()]
    .filter(([key]) => !existingByKey.has(key))
    .map(([, item]) => item);
  const existingItems = existing.map((item) => {
    const key = createMergeKey(item);
    return incomingByKey.get(key) ?? item;
  });

  return [...newItems, ...existingItems];
}

export function makeCandidate(input: {
  src: string;
  title?: string;
  poster?: string;
  pageLink?: string;
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
    pageLink: input.pageLink ?? "",
    duration: input.duration ?? null,
    width: input.width ?? null,
    height: input.height ?? null,
    sourceType: input.sourceType,
    exportable: support.exportable,
    unsupportedReason: support.unsupportedReason
  };
}

function simpleHash(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function chooseBetterSource(previous: string, next: string): string {
  const score = (value: string) => {
    const lower = value.toLowerCase();
    if (lower.startsWith("blob:")) {
      return 0;
    }
    if (lower.includes("thumbnail") || lower.includes("thumb")) {
      return 1;
    }
    if (lower.includes(".mp4")) {
      return 3;
    }
    return 2;
  };

  return score(next) >= score(previous) ? next : previous;
}

function isRedgifsCandidate(candidate: Pick<VideoCandidate, "src" | "poster" | "pageLink">): boolean {
  return [candidate.src, candidate.poster, candidate.pageLink].some((value) => value.includes("redgifs.com"));
}
