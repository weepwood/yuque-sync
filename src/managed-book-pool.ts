import type { ApiRequestPriority } from './api-rate-limiter';
import type {
	ManagedYuqueBook,
	RemoteYuqueDocumentMeta,
	YuqueBookSummary,
	YuqueSyncSettings,
	YuqueUserProfile,
} from './types';

export const AUTO_BOOK_SOFT_LIMIT = 4800;
export const AUTO_BOOK_NAME_PREFIX = 'Obsidian Sync';
export const AUTO_BOOK_SLUG_PREFIX = 'obsidian-sync';
export const AUTO_BOOK_MARKER = '[yuque-sync-managed:v1]';

const NEAR_LIMIT_REFRESH_AT = 4500;
const NEAR_LIMIT_REFRESH_MS = 5 * 60 * 1000;
const NORMAL_REFRESH_MS = 24 * 60 * 60 * 1000;
const MAX_CREATE_COLLISION_ATTEMPTS = 20;

export interface ManagedBookClient {
	getCurrentUser(): Promise<YuqueUserProfile>;
	listUserBooks(login: string, priority?: ApiRequestPriority): Promise<YuqueBookSummary[]>;
	createBook(login: string, name: string, slug: string, description: string): Promise<YuqueBookSummary>;
	listDocuments(bookId: string, priority?: ApiRequestPriority, signal?: AbortSignal): Promise<RemoteYuqueDocumentMeta[]>;
}

function getHttpStatus(error: unknown): number | null {
	if (typeof error !== 'object' || error === null) return null;
	const direct = (error as { status?: unknown }).status;
	if (typeof direct === 'number') return direct;
	const nested = (error as { response?: { status?: unknown } }).response?.status;
	return typeof nested === 'number' ? nested : null;
}

function parseManagedIndex(slug: string): number | null {
	const match = new RegExp(`^${AUTO_BOOK_SLUG_PREFIX}-(\\d{3,})$`).exec(slug);
	if (!match?.[1]) return null;
	const value = Number(match[1]);
	return Number.isFinite(value) && value > 0 ? value : null;
}

function isManagedRemoteBook(book: YuqueBookSummary): boolean {
	return book.description.includes(AUTO_BOOK_MARKER) && parseManagedIndex(book.slug) !== null;
}

function managedBookFromRemote(book: YuqueBookSummary, previous?: ManagedYuqueBook): ManagedYuqueBook {
	return {
		namespace: book.namespace,
		name: book.name,
		slug: book.slug,
		documentCount: previous?.documentCount ?? -1,
		countCheckedAt: previous?.countCheckedAt ?? 0,
		createdAt: previous?.createdAt ?? Date.now(),
	};
}

export class ManagedBookPool {
	private sessionToken = '';
	private sessionOwner: YuqueUserProfile | null = null;
	private allocationTail: Promise<void> = Promise.resolve();

	constructor(
		private readonly client: ManagedBookClient,
		private readonly getToken: () => string,
		private readonly getSettings: () => YuqueSyncSettings,
		private readonly saveSettings: () => Promise<void>,
		private readonly setStatus: (text: string) => void,
	) {}

	allocateBook(): Promise<string> {
		const task = this.allocationTail.then(() => this.allocateInternal());
		this.allocationTail = task.then(() => undefined, () => undefined);
		return task;
	}

	async recordDocumentCreated(namespace: string): Promise<void> {
		const book = this.getSettings().managedBooks.find((item) => item.namespace === namespace);
		if (!book) return;
		book.documentCount = Math.max(0, book.documentCount) + 1;
		await this.saveSettings();
	}

	async shouldRerouteAfterCreateFailure(namespace: string, error: unknown): Promise<boolean> {
		const status = getHttpStatus(error);
		if (status !== 400 && status !== 409 && status !== 422) return false;
		const book = this.getSettings().managedBooks.find((item) => item.namespace === namespace);
		if (!book) return false;
		await this.refreshDocumentCount(book);
		return book.documentCount >= AUTO_BOOK_SOFT_LIMIT;
	}

	private async allocateInternal(): Promise<string> {
		const owner = await this.ensureOwner();
		let books = this.sortedManagedBooks();
		if (books.length === 0) {
			await this.discoverManagedBooks(owner);
			books = this.sortedManagedBooks();
		}
		let current = books[books.length - 1];
		if (!current) current = await this.createNextBook(owner);
		if (this.shouldRefreshCount(current)) await this.refreshDocumentCount(current);
		if (current.documentCount >= AUTO_BOOK_SOFT_LIMIT) current = await this.createNextBook(owner);
		return current.namespace;
	}

	private async ensureOwner(): Promise<YuqueUserProfile> {
		const token = this.getToken().trim();
		if (!token) throw new Error('尚未配置 Yuque Token');
		if (!this.sessionOwner || this.sessionToken !== token) {
			this.sessionOwner = await this.client.getCurrentUser();
			this.sessionToken = token;
		}
		const settings = this.getSettings();
		if (settings.managedBookOwnerLogin !== this.sessionOwner.login) {
			settings.managedBookOwnerLogin = this.sessionOwner.login;
			settings.managedBooks = [];
			await this.saveSettings();
		}
		return this.sessionOwner;
	}

	private async discoverManagedBooks(owner: YuqueUserProfile): Promise<void> {
		const remoteBooks = await this.client.listUserBooks(owner.login, 'normal');
		const settings = this.getSettings();
		const previous = new Map(settings.managedBooks.map((book) => [book.namespace, book]));
		settings.managedBooks = remoteBooks
			.filter(isManagedRemoteBook)
			.map((book) => managedBookFromRemote(book, previous.get(book.namespace)))
			.sort((left, right) => (parseManagedIndex(left.slug) ?? 0) - (parseManagedIndex(right.slug) ?? 0));
		await this.saveSettings();
	}

	private shouldRefreshCount(book: ManagedYuqueBook): boolean {
		if (book.documentCount < 0 || book.countCheckedAt <= 0) return true;
		const age = Date.now() - book.countCheckedAt;
		if (book.documentCount >= NEAR_LIMIT_REFRESH_AT) return age >= NEAR_LIMIT_REFRESH_MS;
		return age >= NORMAL_REFRESH_MS;
	}

	private async refreshDocumentCount(book: ManagedYuqueBook): Promise<void> {
		this.setStatus(`正在确认语雀知识库容量：${book.name}`);
		const documents = await this.client.listDocuments(book.namespace, 'normal');
		book.documentCount = documents.length;
		book.countCheckedAt = Date.now();
		await this.saveSettings();
	}

	private async createNextBook(owner: YuqueUserProfile): Promise<ManagedYuqueBook> {
		let nextIndex = this.nextIndex();
		for (let attempt = 0; attempt < MAX_CREATE_COLLISION_ATTEMPTS; attempt += 1, nextIndex += 1) {
			const suffix = String(nextIndex).padStart(3, '0');
			const name = `${AUTO_BOOK_NAME_PREFIX} ${suffix}`;
			const slug = `${AUTO_BOOK_SLUG_PREFIX}-${suffix}`;
			const description = `由 Obsidian Yuque Sync 插件自动创建和管理。${AUTO_BOOK_MARKER}`;
			this.setStatus(`正在自动创建语雀知识库：${name}`);
			try {
				const created = await this.client.createBook(owner.login, name, slug, description);
				const managed = managedBookFromRemote(created);
				managed.documentCount = 0;
				managed.countCheckedAt = Date.now();
				this.getSettings().managedBooks.push(managed);
				await this.saveSettings();
				return managed;
			} catch (error) {
				if (getHttpStatus(error) !== 422) throw error;
				const remoteBooks = await this.client.listUserBooks(owner.login, 'normal');
				const existing = remoteBooks.find((book) => book.slug === slug);
				if (!existing) throw error;
				if (!isManagedRemoteBook(existing)) continue;
				const managed = managedBookFromRemote(existing);
				this.getSettings().managedBooks.push(managed);
				await this.saveSettings();
				return managed;
			}
		}
		throw new Error('自动创建语雀知识库连续遇到路径冲突，请稍后重试');
	}

	private sortedManagedBooks(): ManagedYuqueBook[] {
		return [...this.getSettings().managedBooks]
			.sort((left, right) => (parseManagedIndex(left.slug) ?? 0) - (parseManagedIndex(right.slug) ?? 0));
	}

	private nextIndex(): number {
		return this.getSettings().managedBooks.reduce((max, book) => {
			return Math.max(max, parseManagedIndex(book.slug) ?? 0);
		}, 0) + 1;
	}
}
