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

export interface FrozenCoverDraft {
  id: string;
  index: number;
  name: string;
  storageKey: string;
  from: number;
  to: number;
}

export interface FrozenCoverAssignment {
  coverId: string;
  coverIndex: number;
  from: number;
  to: number;
}

export interface FrozenExportTask {
  taskId: string;
  videoIndex: number;
  videoSrc: string;
  coverIndex: number;
  coverStorageKey: string;
}

export interface FrozenBatchResult {
  taskId: string;
  videoIndex: number;
  coverIndex: number;
  src: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface FrozenSelectionSnapshot {
  pageUrl: string;
  pageTitle: string;
  createdAt: number;
  videos: VideoCandidate[];
}
