import type { AppConfig } from "../config/env.js";
import type { AppLogger } from "../config/logger.js";
import type { DownloadedImage, YuqueDocumentResult, YuqueImageUploadResult } from "../types.js";
import { AppError } from "../utils/errors.js";
import type { FetchLike } from "./image-download.js";

interface YuqueApiEnvelope<T> { data?: T; message?: string; }
interface YuqueUploadData { url?: string; }
interface YuqueDocData { id?: number; slug?: string; title?: string; url?: string; }

function assertRepoId(repoId: string): string {
  const trimmed = repoId.trim();
  if (!/^[^/\s]+\/[^/\s]+$/.test(trimmed)) {
    throw new AppError("语雀知识库 ID 格式应为 namespace/repo。", "INVALID_YUQUE_REPO", 400);
  }
  return trimmed;
}

function normalizeYuqueUrl(url: string, baseUrl: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return new URL(url, `${baseUrl}/`).toString();
}

async function parseResponseJson<T>(response: Response, action: string): Promise<T> {
  const text = await response.text();
  let value: unknown;
  try { value = JSON.parse(text); } catch {
    const looksLikeLogin = /登录|login|signin/i.test(text);
    throw new AppError(
      looksLikeLogin ? `${action}失败：语雀 Cookie 可能已过期。` : `${action}失败：语雀返回了非 JSON 内容。`,
      "YUQUE_INVALID_RESPONSE", 502,
    );
  }
  return value as T;
}

export class YuqueClient {
  constructor(
    private readonly config: AppConfig,
    private readonly logger: AppLogger,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async uploadImage(image: DownloadedImage): Promise<YuqueImageUploadResult> {
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(image.bytes).buffer], { type: image.mimeType }), image.fileName);
    let response: Response;
    try {
      response = await this.fetchFn(`${this.config.yuqueBaseUrl}${this.config.yuqueUploadPath}`, {
        method: "POST",
        headers: {
          Cookie: this.config.yuqueCookie,
          Referer: `${this.config.yuqueBaseUrl}/`,
          Origin: this.config.yuqueBaseUrl,
          Accept: "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0 YuqueImageMCP/1.0",
        },
        body: form,
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw new AppError("连接语雀图片上传接口失败。", "YUQUE_UPLOAD_NETWORK_ERROR", 502, { cause: error });
    }
    if (response.status === 401 || response.status === 403) {
      throw new AppError("语雀图片上传鉴权失败，请更新 YUQUE_COOKIE。", "YUQUE_COOKIE_EXPIRED", response.status);
    }
    const result = await parseResponseJson<YuqueApiEnvelope<YuqueUploadData>>(response, "上传图片");
    if (!response.ok || !result.data?.url) {
      this.logger.warn({ status: response.status, yuqueMessage: result.message }, "Yuque image upload rejected");
      throw new AppError(`语雀图片上传失败${result.message ? `：${result.message}` : ""}。`, "YUQUE_UPLOAD_REJECTED", 502);
    }
    return { url: normalizeYuqueUrl(result.data.url, this.config.yuqueBaseUrl), raw: result };
  }

  async createOrUpdateDocument(input: {
    repoId?: string; title: string; body: string; slug?: string; isPublic?: boolean;
  }): Promise<YuqueDocumentResult> {
    const repoId = assertRepoId(input.repoId || this.config.yuqueRepo);
    const slug = input.slug?.trim();
    const endpoint = slug
      ? `${this.config.yuqueBaseUrl}/api/v2/repos/${repoId}/docs/${encodeURIComponent(slug)}`
      : `${this.config.yuqueBaseUrl}/api/v2/repos/${repoId}/docs`;
    let response: Response;
    try {
      response = await this.fetchFn(endpoint, {
        method: slug ? "PUT" : "POST",
        headers: {
          "Content-Type": "application/json", Accept: "application/json",
          "X-Auth-Token": this.config.yuqueToken, "User-Agent": "yuque-image-mcp/1.0",
        },
        body: JSON.stringify({
          title: input.title, public: input.isPublic ? "1" : "0", format: "markdown", body: input.body,
        }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
    } catch (error) {
      throw new AppError("连接语雀文档接口失败。", "YUQUE_DOCUMENT_NETWORK_ERROR", 502, { cause: error });
    }
    const result = await parseResponseJson<YuqueApiEnvelope<YuqueDocData>>(response, slug ? "更新文档" : "创建文档");
    if (!response.ok || !result.data?.id || !result.data.slug) {
      throw new AppError(
        `语雀${slug ? "更新" : "创建"}文档失败${result.message ? `：${result.message}` : ""}。`,
        "YUQUE_DOCUMENT_REJECTED", response.status || 502,
      );
    }
    const docUrl = result.data.url
      ? normalizeYuqueUrl(result.data.url, this.config.yuqueBaseUrl)
      : `${this.config.yuqueBaseUrl}/${repoId}/${result.data.slug}`;
    return {
      id: result.data.id, slug: result.data.slug, title: result.data.title || input.title,
      url: docUrl, updated: Boolean(slug),
    };
  }

  async addDocumentToToc(repoId: string | undefined, documentId: number): Promise<void> {
    const normalizedRepoId = assertRepoId(repoId || this.config.yuqueRepo);
    const response = await this.fetchFn(`${this.config.yuqueBaseUrl}/api/v2/repos/${normalizedRepoId}/toc`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json", Accept: "application/json",
        "X-Auth-Token": this.config.yuqueToken, "User-Agent": "yuque-image-mcp/1.0",
      },
      body: JSON.stringify({ action: "appendNode", action_mode: "sibling", type: "DOC", doc_ids: [documentId] }),
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    if (!response.ok) {
      const result = await parseResponseJson<YuqueApiEnvelope<unknown>>(response, "更新目录");
      throw new AppError(
        `文档已创建，但加入语雀目录失败${result.message ? `：${result.message}` : ""}。`,
        "YUQUE_TOC_REJECTED", response.status,
      );
    }
  }

  async checkToken(): Promise<{ login: string; name: string }> {
    const response = await this.fetchFn(`${this.config.yuqueBaseUrl}/api/v2/user`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Auth-Token": this.config.yuqueToken, "User-Agent": "yuque-image-mcp/1.0" },
      signal: AbortSignal.timeout(this.config.requestTimeoutMs),
    });
    const result = await parseResponseJson<YuqueApiEnvelope<{ login?: string; name?: string }>>(response, "检查语雀 Token");
    if (!response.ok || !result.data?.login) {
      throw new AppError(`语雀 Token 校验失败${result.message ? `：${result.message}` : ""}。`, "YUQUE_TOKEN_INVALID", response.status);
    }
    return { login: result.data.login, name: result.data.name || result.data.login };
  }
}
