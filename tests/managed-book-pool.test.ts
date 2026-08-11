import { describe, expect, it } from 'vitest';
import { AUTO_BOOK_MARKER, ManagedBookPool, type ManagedBookClient } from '../src/managed-book-pool';
import {
	DEFAULT_SETTINGS,
	type RemoteYuqueDocumentMeta,
	type YuqueBookSummary,
	type YuqueSyncSettings,
	type YuqueUserProfile,
} from '../src/types';

function settings(overrides: Partial<YuqueSyncSettings> = {}): YuqueSyncSettings {
	return {
		...DEFAULT_SETTINGS,
		pendingCreates: {},
		syncIndex: {},
		dirtyFiles: [],
		apiRequestHistory: [],
		managedBooks: [],
		...overrides,
	};
}

class FakeClient implements ManagedBookClient {
	user: YuqueUserProfile = { id: 1, login: 'alice', name: 'Alice' };
	books: YuqueBookSummary[] = [];
	documentCounts = new Map<string, number>();
	created: string[] = [];

	async getCurrentUser(): Promise<YuqueUserProfile> { return this.user; }
	async listUserBooks(): Promise<YuqueBookSummary[]> { return [...this.books]; }
	async createBook(login: string, name: string, slug: string, description: string): Promise<YuqueBookSummary> {
		const book: YuqueBookSummary = { id: this.books.length + 1, name, slug, namespace: `${login}/${slug}`, description, public: 0 };
		this.books.push(book);
		this.created.push(book.namespace);
		this.documentCounts.set(book.namespace, 0);
		return book;
	}
	async listDocuments(bookId: string): Promise<RemoteYuqueDocumentMeta[]> {
		const count = this.documentCounts.get(bookId) ?? 0;
		return Array.from({ length: count }, (_, index) => ({ slug: `doc-${index}`, updatedAt: '' }));
	}
}

function pool(client: FakeClient, state: YuqueSyncSettings): ManagedBookPool {
	return new ManagedBookPool(client, () => 'token', () => state, async () => undefined, () => undefined);
}

describe('ManagedBookPool', () => {
	it('creates the first managed private book using only the token owner', async () => {
		const client = new FakeClient();
		const state = settings();
		const manager = pool(client, state);
		await expect(manager.allocateBook()).resolves.toBe('alice/obsidian-sync-001');
		expect(client.created).toEqual(['alice/obsidian-sync-001']);
		expect(state.managedBookOwnerLogin).toBe('alice');
		expect(client.books[0]?.description).toContain(AUTO_BOOK_MARKER);
	});

	it('switches to the next book after the 4800 soft limit', async () => {
		const client = new FakeClient();
		const now = Date.now();
		const state = settings({ managedBookOwnerLogin: 'alice', managedBooks: [{ namespace: 'alice/obsidian-sync-001', name: 'Obsidian Sync 001', slug: 'obsidian-sync-001', documentCount: 4799, countCheckedAt: now, createdAt: now }] });
		const manager = pool(client, state);
		await expect(manager.allocateBook()).resolves.toBe('alice/obsidian-sync-001');
		await manager.recordDocumentCreated('alice/obsidian-sync-001');
		await expect(manager.allocateBook()).resolves.toBe('alice/obsidian-sync-002');
	});

	it('discovers a managed book after local state is lost', async () => {
		const client = new FakeClient();
		client.books = [{ id: 7, name: 'Obsidian Sync 003', slug: 'obsidian-sync-003', namespace: 'alice/obsidian-sync-003', description: `managed ${AUTO_BOOK_MARKER}`, public: 0 }];
		client.documentCounts.set('alice/obsidian-sync-003', 4700);
		const state = settings();
		const manager = pool(client, state);
		await expect(manager.allocateBook()).resolves.toBe('alice/obsidian-sync-003');
		expect(client.created).toEqual([]);
		expect(state.managedBooks[0]?.documentCount).toBe(4700);
	});

	it('resets the pool when the token belongs to another account', async () => {
		const client = new FakeClient();
		client.user = { id: 2, login: 'bob', name: 'Bob' };
		const state = settings({ managedBookOwnerLogin: 'alice', managedBooks: [{ namespace: 'alice/obsidian-sync-001', name: 'Obsidian Sync 001', slug: 'obsidian-sync-001', documentCount: 100, countCheckedAt: Date.now(), createdAt: Date.now() }] });
		const manager = pool(client, state);
		await expect(manager.allocateBook()).resolves.toBe('bob/obsidian-sync-001');
		expect(state.managedBookOwnerLogin).toBe('bob');
	});

	it('rechecks capacity after a likely capacity-related create failure', async () => {
		const client = new FakeClient();
		const now = Date.now();
		const state = settings({ managedBookOwnerLogin: 'alice', managedBooks: [{ namespace: 'alice/obsidian-sync-001', name: 'Obsidian Sync 001', slug: 'obsidian-sync-001', documentCount: 4300, countCheckedAt: now, createdAt: now }] });
		client.documentCounts.set('alice/obsidian-sync-001', 5000);
		const manager = pool(client, state);
		const error = new Error('repository full') as Error & { status: number };
		error.status = 422;
		await expect(manager.shouldRerouteAfterCreateFailure('alice/obsidian-sync-001', error)).resolves.toBe(true);
		expect(state.managedBooks[0]?.documentCount).toBe(5000);
	});
});
