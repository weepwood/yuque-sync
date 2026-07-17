export interface OpenAIFileReference {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}

export interface DownloadedImage {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  sourceFileId: string;
}

export interface YuqueImageUploadResult {
  url: string;
  raw: unknown;
}

export interface YuqueDocumentResult {
  id: number;
  slug: string;
  title: string;
  url: string;
  updated: boolean;
}

export interface ImageDocumentInput {
  title: string;
  imageUrl: string;
  prompt?: string;
  generatedPrompt?: string;
  description?: string;
  category?: string;
  tags?: string[];
  source?: string;
  sourceFileName?: string;
  sourceMimeType?: string;
  sourceFileId?: string;
  metadata?: Record<string, unknown>;
  timezone: string;
}
