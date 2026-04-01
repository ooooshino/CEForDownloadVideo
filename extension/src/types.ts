export type VideoSourceType = "dom" | "mutation" | "performance" | "network";

export interface VideoCandidate {
  id: string;
  src: string;
  title: string;
  poster: string;
  pageLink: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  sourceType: VideoSourceType;
  exportable: boolean;
  unsupportedReason: string;
}

export interface TabVideoState {
  tabId: number;
  pageUrl: string;
  pageTitle: string;
  updatedAt: number;
  videos: VideoCandidate[];
}

export interface ExportResultItem {
  src: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}
