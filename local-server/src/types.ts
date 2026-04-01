export interface ExportRequestPayload {
  pageUrl: string;
  duration: number;
  videos: string[];
  coverPath: string;
}

export interface ExportResultItem {
  src: string;
  success: boolean;
  outputPath?: string;
  error?: string;
}

