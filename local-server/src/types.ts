export interface ExportRequestPayload {
  pageUrl: string;
  startTime: number;
  endTime: number;
  videos: string[];
  coverPath: string;
}

export interface ExportResultItem {
  src: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}

export interface BatchExportTask {
  taskId: string;
  videoIndex: number;
  videoSrc: string;
  coverIndex: number;
  coverUploadField: string;
}

export interface BatchExportRequestPayload {
  pageUrl: string;
  startTime: number;
  endTime: number;
  tasks: BatchExportTask[];
}

export interface BatchExportResult {
  taskId: string;
  videoIndex: number;
  coverIndex: number;
  src: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}
