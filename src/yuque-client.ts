import { requestUrl } from 'obsidian';
import {
	type ApiRateLimitSnapshot,
	type ApiRequestPriority,
	YuqueApiRateLimiter,
} from './api-rate-limiter';
import type {
	CreatedYuqueDocument,
	RemoteYuqueDocumentMeta,
	YuqueDocument,
	YuqueSyncSettings,
} from './types';

interface YuqueEnvelope<T> {
	data: T;
}

interface YuqueDocumentPayload {
	id: number;
	slug: string;
	title?: string;
	body?: string;
	updated_at?: string;
}

const DOCUMENT_LIST_PAGE_SIZE = 100;
const MAX_DOCUMENT_LIST_PAGES = 500;
const MAX_RATE_LIMIT_RETRIES = 3;

export class YuqueClient {
	private readonly rateLimiter: YuqueApiRateLimiter;

	constructor(
		private readonly getToken: () => string,
		private readonly getCookie: () => string,
		getSettings: () => YuqueSyncSettings,
		saveSettings: () => Promise<void>,
		setStatus: (text: string) => void,
	) {
		this.rateLimiter = new YuqueApiRateLimiter(getSettings, saveSettings, setStatus);
	}

	async getDocument(
		bookId: string,
		slug: string,
		priority: ApiRequestPriority = 'high',
		signal?: AbortSignal,
	): Promise<YuqueDocument> {
		const response = await this.requestOpenApi(() => requestUrl({
			url: `${this.apiBase(bookId)}/docs/${encodeURIComponent(slug)}`,
			method: 'GET',
			headers: this.authHeaders(),
		}), priority, signal);
		const payload = response.json as YuqueEnvelope<YuqueDocumentPayload>;
		return {
			title: payload.data.title ?? '',
			content: payload.data.body ?? '',
			updatedAt: payload.data.updated_at ?? '',
		};
	}

	async listDocuments(
		bookId: string,
		priority: ApiRequestPriority = 'low',
		signal?: AbortSignal,
	): Promise<RemoteYuqueDocumentMeta[]> {
		const results: RemoteYuqueDocumentMeta[] = [];
		const seen = new Set<string>();
		let offset = 0;

		for (let page = 0; page < MAX_DOCUMENT_LIST_PAGES; page += 1) {
			const response = await this.requestOpenApi(() => requestUrl({
				url: `${this.apiBase(bookId)}/docs?offset=${offset}&limit=${DOCUMENT_LIST_PAGE_SIZE}`,
				method: 'GET',
				headers: this.authHeaders(),
			}), priority, signal);
			const payload = response.json as YuqueEnvelope<YuqueDocumentPayload[]>;
			if (!Array.isArray(payload.data)) {
				throw new Error('语雀文档列表接口返回了未知数据格式');
			}
			if (payload.data.length === 0) {
				break;
			}

			let added = 0;
			for (const document of payload.data) {
				if (!document.slug || seen.has(document.slug)) {
					continue;
				}
				seen.add(document.slug);
				results.push({
					slug: document.slug,
					updatedAt: document.updated_at ?? '',
				});
				added += 1;
			}

			// 如果服务端忽略 offset/limit 并重复返回同一页，避免死循环。
			if (added === 0 || payload.data.length < DOCUMENT_LIST_PAGE_SIZE) {
				break;
			}
			offset += payload.data.length;
		}

		return results;
	}

	async updateDocument(bookId: string, slug: string, title: string, content: string): Promise<string> {
		const response = await this.requestOpenApi(() => requestUrl({
			url: `${this.apiBase(bookId)}/docs/${encodeURIComponent(slug)}`,
			method: 'PUT',
			headers: this.authHeaders(),
			body: JSON.stringify({
				title,
				public: 0,
				format: 'markdown',
				body: content,
			}),
		}), 'high');
		const payload = response.json as Partial<YuqueEnvelope<YuqueDocumentPayload>>;
		return payload.data?.updated_at ?? '';
	}

	async createDocument(bookId: string, title: string, content: string): Promise<CreatedYuqueDocument> {
		const response = await this.requestOpenApi(() => requestUrl({
			url: `${this.apiBase(bookId)}/docs`,
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({
				title,
				public: 0,
				format: 'markdown',
				body: content,
			}),
		}), 'high');
		const payload = response.json as YuqueEnvelope<YuqueDocumentPayload>;
		if (!payload.data?.id || !payload.data.slug) {
			throw new Error('语雀创建文档接口未返回文档 ID 或 slug');
		}
		return {
			id: payload.data.id,
			slug: payload.data.slug,
			updatedAt: payload.data.updated_at ?? '',
		};
	}

	async addDocumentToToc(bookId: string, documentId: number): Promise<boolean> {
		try {
			await this.requestOpenApi(() => requestUrl({
				url: `${this.apiBase(bookId)}/toc`,
				method: 'PUT',
				headers: this.authHeaders(),
				body: JSON.stringify({
					action: 'appendNode',
					action_mode: 'sibling',
					type: 'DOC',
					doc_ids: [documentId],
				}),
			}), 'normal');
			return true;
		} catch (error) {
			console.error('[Yuque Sync] 文档已创建，但加入目录失败', error);
			return false;
		}
	}

	async uploadImage(fileName: string, fileData: ArrayBuffer): Promise<string> {
		const cookie = this.getCookie().trim();
		if (!cookie) {
			throw new Error('尚未配置 Yuque Cookie');
		}

		const boundary = `YuqueSync${Date.now()}${Math.random().toString(36).slice(2)}`;
		const safeFileName = fileName.replace(/["\r\n]/g, '_');
		const encoder = new TextEncoder();
		const header = encoder.encode(
			`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${safeFileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
		);
		const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
		const body = new Uint8Array(header.length + fileData.byteLength + footer.length);
		body.set(header, 0);
		body.set(new Uint8Array(fileData), header.length);
		body.set(footer, header.length + fileData.byteLength);

		const response = await requestUrl({
			url: 'https://www.yuque.com/api/upload/attach',
			method: 'POST',
			headers: {
				Referer: 'https://www.yuque.com',
				Cookie: cookie,
				'Content-Type': `multipart/form-data; boundary=${boundary}`,
			},
			body: body.buffer,
		});
		const payload = response.json as { data?: { url?: string } };
		if (!payload.data?.url) {
			throw new Error('语雀图片接口未返回图片地址');
		}
		return payload.data.url;
	}

	getRateLimitSnapshot(): ApiRateLimitSnapshot {
		return this.rateLimiter.getSnapshot();
	}

	dispose(): void {
		this.rateLimiter.dispose();
	}

	async flushRateLimiter(): Promise<void> {
		await this.rateLimiter.flush();
	}

	private async requestOpenApi<T>(
		operation: () => Promise<T>,
		priority: ApiRequestPriority,
		signal?: AbortSignal,
	): Promise<T> {
		for (let attempt = 0; ; attempt += 1) {
			try {
				return await this.rateLimiter.schedule(operation, priority, signal);
			} catch (error) {
				if (!this.rateLimiter.isRateLimitError(error) || attempt >= MAX_RATE_LIMIT_RETRIES) {
					throw error;
				}
			}
		}
	}

	private apiBase(bookId: string): string {
		const encodedBookId = bookId.split('/').map(encodeURIComponent).join('/');
		return `https://www.yuque.com/api/v2/repos/${encodedBookId}`;
	}

	private authHeaders(): Record<string, string> {
		const token = this.getToken().trim();
		if (!token) {
			throw new Error('尚未配置 Yuque Token');
		}
		return {
			'Content-Type': 'application/json',
			'X-Auth-Token': token,
		};
	}
}
