import path from "node:path";

const extensionByMime: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/x-icon": ".ico",
  "image/tiff": ".tiff",
  "image/avif": ".avif",
};

export function sanitizeFileName(value: string | undefined, mimeType: string): string {
  const fallback = `chatgpt-image-${Date.now()}${extensionByMime[mimeType] ?? ".bin"}`;
  if (!value?.trim()) return fallback;
  const baseName = path.basename(value.trim()).replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  const clipped = baseName.slice(0, 180).trim();
  if (!clipped) return fallback;
  if (path.extname(clipped)) return clipped;
  return `${clipped}${extensionByMime[mimeType] ?? ""}`;
}

export function normalizeMimeType(value: string | null | undefined): string {
  return (value ?? "").split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}
