import { requestUrl } from 'obsidian';
import type { CreatedYuqueDocument, YuqueDocument } from './types';

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

export class YuqueClient {
	constructor(
		private readonly getToken: () => string,
		private readonly getCookie: () => string,
	) {}

	async getDocument(bookId: string, slug: string): Promise<YuqueDocument> {
		const response = await requestUrl({
			url: `${this.apiBase(bookId)}/docs/${encodeURIComponent(slug)}`,
			method: 'GET',
			headers: this.authHeaders(),
		});
		const payload = response.json as YuqueEnvelope<YuqueDocumentPayload>;
		return {
			title: payload.data.title ?? '',
			content: payload.data.body ?? '',
			updatedAt: payload.data.updated_at ?? '',
		};
	}

	async updateDocument(bookId: string, slug: string, title: string, content: string): Promise<void> {
		await requestUrl({
			url: `${this.apiBase(bookId)}/docs/${encodeURIComponent(slug)}`,
			method: 'PUT',
			headers: this.authHeaders(),
			body: JSON.stringify({
				title,
				public: 0,
				format: 'markdown',
				body: content,
			}),
		});
	}

	async createDocument(bookId: string, title: string, content: string): Promise<CreatedYuqueDocument> {
		const response = await requestUrl({
			url: `${this.apiBase(bookId)}/docs`,
			method: 'POST',
			headers: this.authHeaders(),
			body: JSON.stringify({
				title,
				public: 0,
				format: 'markdown',
				body: content,
			}),
		});
		const payload = response.json as YuqueEnvelope<YuqueDocumentPayload>;
		if (!payload.data?.id || !payload.data.slug) {
			throw new Error('语雀创建文档接口未返回文档 ID 或 slug');
		}
		return { id: payload.data.id, slug: payload.data.slug };
	}

	async addDocumentToToc(bookId: string, documentId: number): Promise<boolean> {
		try {
			await requestUrl({
				url: `${this.apiBase(bookId)}/toc`,
				method: 'PUT',
				headers: this.authHeaders(),
				body: JSON.stringify({
					action: 'appendNode',
					action_mode: 'sibling',
					type: 'DOC',
					doc_ids: [documentId],
				}),
			});
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
