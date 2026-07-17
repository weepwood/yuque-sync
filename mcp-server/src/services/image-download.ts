import type { AppConfig } from "../config/env.js";
import type { DownloadedImage, OpenAIFileReference } from "../types.js";
import { AppError } from "../utils/errors.js";
import { normalizeMimeType, sanitizeFileName } from "../utils/file.js";
import { assertSafeDownloadUrl, readBodyWithLimit } from "../utils/network.js";

export type FetchLike = typeof fetch;

export async function downloadImage(
  file: OpenAIFileReference,
  config: Pick<AppConfig, "downloadAllowedHosts" | "maxImageBytes" | "requestTimeoutMs">,
  fetchFn: FetchLike = fetch,
): Promise<DownloadedImage> {
  let currentUrl = await assertSafeDownloadUrl(file.download_url, config.downloadAllowedHosts);
  const signal = AbortSignal.timeout(config.requestTimeoutMs);
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetchFn(currentUrl, {
        method: "GET", redirect: "manual", signal,
        headers: { Accept: "image/*,application/octet-stream;q=0.8", "User-Agent": "yuque-image-mcp/1.0" },
      });
    } catch (error) {
      throw new AppError("下载 ChatGPT 图片失败。", "IMAGE_DOWNLOAD_FAILED", 502, { cause: error });
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new AppError("图片下载重定向缺少目标地址。", "INVALID_IMAGE_REDIRECT", 502);
      currentUrl = await assertSafeDownloadUrl(new URL(location, currentUrl).toString(), config.downloadAllowedHosts);
      continue;
    }
    if (!response.ok) {
      throw new AppError(`下载 ChatGPT 图片失败（HTTP ${response.status}）。`, "IMAGE_DOWNLOAD_HTTP_ERROR", 502);
    }
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > config.maxImageBytes) {
      throw new AppError("图片超过服务允许的大小。", "IMAGE_TOO_LARGE", 413);
    }
    const responseMime = normalizeMimeType(response.headers.get("content-type"));
    const declaredMime = normalizeMimeType(file.mime_type);
    const mimeType = responseMime.startsWith("image/") ? responseMime : declaredMime;
    if (!mimeType.startsWith("image/")) {
      throw new AppError(`文件不是受支持的图片类型：${mimeType}`, "UNSUPPORTED_IMAGE_TYPE", 415);
    }
    const bytes = await readBodyWithLimit(response.body, config.maxImageBytes);
    if (bytes.byteLength === 0) throw new AppError("下载到的图片为空。", "EMPTY_IMAGE", 400);
    return {
      bytes,
      fileName: sanitizeFileName(file.file_name, mimeType),
      mimeType,
      sourceFileId: file.file_id,
    };
  }
  throw new AppError("图片下载重定向次数过多。", "TOO_MANY_REDIRECTS", 502);
}
