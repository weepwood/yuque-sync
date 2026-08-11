from pathlib import Path


def must_replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    content = file.read_text()
    if old not in content:
        raise SystemExit(f'target missing in {path}: {old[:120]!r}')
    file.write_text(content.replace(old, new, count))


# types
must_replace(
    'src/types.ts',
    "export interface PendingCreate {\n",
    "export interface ManagedYuqueBook {\n\tnamespace: string;\n\tname: string;\n\tslug: string;\n\tdocumentCount: number;\n\tcountCheckedAt: number;\n\tcreatedAt: number;\n}\n\nexport interface PendingCreate {\n",
)
must_replace(
    'src/types.ts',
    "\tyuqueToken: string;\n\tdefaultBookId: string;\n\tyuqueCookie: string;\n\tpendingCreates: Record<string, PendingCreate>;",
    "\tyuqueToken: string;\n\t/** @deprecated 1.3.3 起新文档由插件自动选择/创建知识库，仅保留旧配置兼容。 */\n\tdefaultBookId: string;\n\tyuqueCookie: string;\n\tmanagedBookOwnerLogin: string;\n\tmanagedBooks: ManagedYuqueBook[];\n\tpendingCreates: Record<string, PendingCreate>;",
)
must_replace(
    'src/types.ts',
    "\tyuqueCookie: '',\n\tpendingCreates: {},",
    "\tyuqueCookie: '',\n\tmanagedBookOwnerLogin: '',\n\tmanagedBooks: [],\n\tpendingCreates: {},",
)
must_replace(
    'src/types.ts',
    "export interface YuqueLocation {",
    "export interface YuqueUserProfile {\n\tid: number;\n\tlogin: string;\n\tname: string;\n}\n\nexport interface YuqueBookSummary {\n\tid: number;\n\tname: string;\n\tslug: string;\n\tnamespace: string;\n\tdescription: string;\n\tpublic: number;\n}\n\nexport interface YuqueLocation {",
)

# client
must_replace(
    'src/yuque-client.ts',
    "\tCreatedYuqueDocument,\n\tRemoteYuqueDocumentMeta,",
    "\tCreatedYuqueDocument,\n\tRemoteYuqueDocumentMeta,\n\tYuqueBookSummary,",
)
must_replace(
    'src/yuque-client.ts',
    "\tYuqueDocument,\n\tYuqueSyncSettings,",
    "\tYuqueDocument,\n\tYuqueSyncSettings,\n\tYuqueUserProfile,",
)
must_replace(
    'src/yuque-client.ts',
    "interface YuqueDocumentPayload {",
    "interface YuqueUserPayload {\n\tid: number;\n\tlogin: string;\n\tname?: string;\n}\n\ninterface YuqueBookPayload {\n\tid: number;\n\tslug: string;\n\tname?: string;\n\tnamespace?: string;\n\tdescription?: string;\n\tpublic?: number;\n}\n\ninterface YuqueDocumentPayload {",
)
must_replace(
    'src/yuque-client.ts',
    "const DOCUMENT_LIST_PAGE_SIZE = 100;",
    "const BOOK_LIST_PAGE_SIZE = 100;\nconst MAX_BOOK_LIST_PAGES = 100;\nconst DOCUMENT_LIST_PAGE_SIZE = 100;",
)
client_path = Path('src/yuque-client.ts')
client = client_path.read_text()
marker = "\tasync getDocument(\n"
if marker not in client:
    raise SystemExit('client insertion marker missing')
methods = """\tasync getCurrentUser(): Promise<YuqueUserProfile> {
\t\tconst response = await this.requestOpenApi(() => requestUrl({
\t\t\turl: 'https://www.yuque.com/api/v2/user',
\t\t\tmethod: 'GET',
\t\t\theaders: this.authHeaders(),
\t\t}), 'high');
\t\tconst payload = response.json as YuqueEnvelope<YuqueUserPayload>;
\t\tif (!payload.data?.id || !payload.data.login) {
\t\t\tthrow new Error('语雀当前用户接口未返回用户 ID 或 login');
\t\t}
\t\treturn {
\t\t\tid: payload.data.id,
\t\t\tlogin: payload.data.login,
\t\t\tname: payload.data.name ?? payload.data.login,
\t\t};
\t}

\tasync listUserBooks(login: string, priority: ApiRequestPriority = 'normal'): Promise<YuqueBookSummary[]> {
\t\tconst results: YuqueBookSummary[] = [];
\t\tconst seen = new Set<string>();
\t\tlet offset = 0;
\t\tfor (let page = 0; page < MAX_BOOK_LIST_PAGES; page += 1) {
\t\t\tconst response = await this.requestOpenApi(() => requestUrl({
\t\t\t\turl: `https://www.yuque.com/api/v2/users/${encodeURIComponent(login)}/repos?offset=${offset}&limit=${BOOK_LIST_PAGE_SIZE}`,
\t\t\t\tmethod: 'GET',
\t\t\t\theaders: this.authHeaders(),
\t\t\t}), priority);
\t\t\tconst payload = response.json as YuqueEnvelope<YuqueBookPayload[]>;
\t\t\tif (!Array.isArray(payload.data)) throw new Error('语雀知识库列表接口返回了未知数据格式');
\t\t\tif (payload.data.length === 0) break;
\t\t\tlet added = 0;
\t\t\tfor (const book of payload.data) {
\t\t\t\tif (!book.slug) continue;
\t\t\t\tconst namespace = book.namespace || `${login}/${book.slug}`;
\t\t\t\tif (seen.has(namespace)) continue;
\t\t\t\tseen.add(namespace);
\t\t\t\tresults.push({
\t\t\t\t\tid: book.id,
\t\t\t\t\tname: book.name ?? book.slug,
\t\t\t\t\tslug: book.slug,
\t\t\t\t\tnamespace,
\t\t\t\t\tdescription: book.description ?? '',
\t\t\t\t\tpublic: book.public ?? 0,
\t\t\t\t});
\t\t\t\tadded += 1;
\t\t\t}
\t\t\tif (added === 0 || payload.data.length < BOOK_LIST_PAGE_SIZE) break;
\t\t\toffset += payload.data.length;
\t\t}
\t\treturn results;
\t}

\tasync createBook(login: string, name: string, slug: string, description: string): Promise<YuqueBookSummary> {
\t\tconst response = await this.requestOpenApi(() => requestUrl({
\t\t\turl: `https://www.yuque.com/api/v2/users/${encodeURIComponent(login)}/repos`,
\t\t\tmethod: 'POST',
\t\t\theaders: this.authHeaders(),
\t\t\tbody: JSON.stringify({ name, slug, description, public: 0 }),
\t\t}), 'high');
\t\tconst payload = response.json as YuqueEnvelope<YuqueBookPayload>;
\t\tif (!payload.data?.id || !payload.data.slug) {
\t\t\tthrow new Error('语雀创建知识库接口未返回知识库 ID 或 slug');
\t\t}
\t\treturn {
\t\t\tid: payload.data.id,
\t\t\tname: payload.data.name ?? name,
\t\t\tslug: payload.data.slug,
\t\t\tnamespace: payload.data.namespace || `${login}/${payload.data.slug}`,
\t\t\tdescription: payload.data.description ?? description,
\t\t\tpublic: payload.data.public ?? 0,
\t\t};
\t}

"""
client_path.write_text(client.replace(marker, methods + marker, 1))

# managed book pool
Path('src/managed-book-pool.ts').write_text(r"""import type { ApiRequestPriority } from './api-rate-limiter';
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
""")

# main: only local edits around creation paths
must_replace('main.ts', "\tnormalizeBookId,\n", "")
must_replace(
    'main.ts',
    "import { YuqueSyncSettingTab } from './src/settings-tab';",
    "import { ManagedBookPool } from './src/managed-book-pool';\nimport { YuqueSyncSettingTab } from './src/settings-tab';",
)
must_replace(
    'main.ts',
    "\tprivate operationInProgress = false;\n\tprivate syncEngine!: SyncEngine;",
    "\tprivate operationInProgress = false;\n\tprivate syncEngine!: SyncEngine;\n\tprivate bookPool!: ManagedBookPool;",
)
must_replace(
    'main.ts',
    "\t\tthis.syncEngine = new SyncEngine(\n",
    "\t\tthis.bookPool = new ManagedBookPool(\n\t\t\tthis.client,\n\t\t\t() => this.pluginSettings.yuqueToken,\n\t\t\t() => this.pluginSettings,\n\t\t\t() => this.saveSettings(),\n\t\t\t(text) => this.setStatus(text),\n\t\t);\n\t\tthis.syncEngine = new SyncEngine(\n",
)
must_replace(
    'main.ts',
    "\t\t\tpendingCreates: saved?.pendingCreates ?? {},",
    "\t\t\tmanagedBookOwnerLogin: saved?.managedBookOwnerLogin ?? '',\n\t\t\tmanagedBooks: saved?.managedBooks ?? [],\n\t\t\tpendingCreates: saved?.pendingCreates ?? {},",
)
must_replace(
    'main.ts',
    "\t\tconst bookId = this.requireDefaultBookId();\n\t\tconst confirmed = await ConfirmModal.show(\n\t\t\tthis.app,\n\t\t\t'创建语雀文档？',\n\t\t\t`当前文件没有 yuque_link，将在 ${bookId} 中创建新文档。`,\n\t\t);",
    "\t\tconst confirmed = await ConfirmModal.show(\n\t\t\tthis.app,\n\t\t\t'创建语雀文档？',\n\t\t\t'当前文件没有 yuque_link。插件会根据容量自动选择或创建私密语雀知识库，然后创建文档。',\n\t\t);",
)
must_replace('main.ts', "const result = await this.createYuqueDocumentForFile(file, bookId);", "const result = await this.createYuqueDocumentForFile(file);", 1)
must_replace(
    'main.ts',
    "\t\tconst bookId = this.requireDefaultBookId();\n\t\tconst { files, invalidCount } = await this.collectUnlinkedDocuments();",
    "\t\tconst { files, invalidCount } = await this.collectUnlinkedDocuments();",
)
must_replace(
    'main.ts',
    "`将在 ${bookId} 中创建 ${files.length} 篇未关联文档。任务会串行执行，并为成功创建的文档写回 yuque_link。${invalidCount ? `\\n另有 ${invalidCount} 篇文档因读取或 YAML 异常不会处理。` : ''}`",
    "`将创建 ${files.length} 篇未关联文档。插件会按容量自动选择或创建私密语雀知识库，任务串行执行，并为成功创建的文档写回 yuque_link。${invalidCount ? `\\n另有 ${invalidCount} 篇文档因读取或 YAML 异常不会处理。` : ''}`",
)
must_replace('main.ts', "const result = await this.createYuqueDocumentForFile(file, bookId);", "const result = await this.createYuqueDocumentForFile(file);", 1)
must_replace(
    'main.ts',
    "\tprivate async createYuqueDocumentForFile(file: TFile, bookId: string): Promise<CreateDocumentResult> {",
    "\tprivate async createYuqueDocumentForFile(file: TFile): Promise<CreateDocumentResult> {",
)
must_replace(
    'main.ts',
    "\t\tconst created = await this.client.createDocument(\n\t\t\tbookId,\n\t\t\tfile.basename,\n\t\t\tsplitMarkdown(content).body,\n\t\t);",
    "\t\tlet bookId = await this.bookPool.allocateBook();\n\t\tlet created;\n\t\ttry {\n\t\t\tcreated = await this.client.createDocument(\n\t\t\t\tbookId,\n\t\t\t\tfile.basename,\n\t\t\t\tsplitMarkdown(content).body,\n\t\t\t);\n\t\t} catch (error) {\n\t\t\tif (!(await this.bookPool.shouldRerouteAfterCreateFailure(bookId, error))) throw error;\n\t\t\tbookId = await this.bookPool.allocateBook();\n\t\t\tcreated = await this.client.createDocument(\n\t\t\t\tbookId,\n\t\t\t\tfile.basename,\n\t\t\t\tsplitMarkdown(content).body,\n\t\t\t);\n\t\t}",
)
must_replace(
    'main.ts',
    "\t\tawait this.saveSettings();\n\n\t\tlet latestContent: string;",
    "\t\tawait this.saveSettings();\n\t\tawait this.bookPool.recordDocumentCreated(bookId);\n\n\t\tlet latestContent: string;",
    1,
)
main_path = Path('main.ts')
main = main_path.read_text()
start = main.find("\n\tprivate requireDefaultBookId(): string {")
end = main.find("\n\tprivate requireCookie(): void {", start)
if start < 0 or end < 0:
    raise SystemExit('requireDefaultBookId block missing')
main_path.write_text(main[:start] + main[end:])

# settings UI
settings_path = Path('src/settings-tab.ts')
settings = settings_path.read_text()
old_setting = """\t\tnew Setting(connectionGroup)
\t\t\t.setName('默认知识库')
\t\t\t.setDesc('新建语雀文档时使用，格式为 namespace/book。')
\t\t\t.addText((text) => {
\t\t\t\ttext.setPlaceholder('weepwood/test')
\t\t\t\t\t.setValue(this.host.pluginSettings.defaultBookId)
\t\t\t\t\t.onChange((value) => {
\t\t\t\t\t\tthis.host.pluginSettings.defaultBookId = value.trim();
\t\t\t\t\t\tthis.scheduleSave();
\t\t\t\t\t});
\t\t\t\ttext.inputEl.addClass('yuque-sync-wide-input');
\t\t\t});

"""
new_setting = """\t\tconst managedBooks = this.host.pluginSettings.managedBooks ?? [];
\t\tconst currentBook = managedBooks[managedBooks.length - 1];
\t\tconst currentCount = currentBook && currentBook.documentCount >= 0
\t\t\t? `${currentBook.documentCount} / 4800`
\t\t\t: '待首次容量校验';
\t\tnew Setting(connectionGroup)
\t\t\t.setName('自动知识库分片')
\t\t\t.setDesc(managedBooks.length > 0
\t\t\t\t? `无需配置知识库。当前 Token 账号：${this.host.pluginSettings.managedBookOwnerLogin || '自动识别'}；已托管 ${managedBooks.length} 个知识库；当前 ${currentBook?.name ?? '-'}（${currentCount}）。接近 4800 篇时会自动创建下一库。`
\t\t\t\t: '无需配置知识库。首次创建文档时，插件会使用 Token 自动识别语雀账号并创建私密的 Obsidian Sync 001；接近 4800 篇时自动创建 002、003……');

"""
if old_setting not in settings:
    raise SystemExit('default book UI block missing')
settings = settings.replace(old_setting, new_setting, 1)
settings = settings.replace(
    ".setDesc('用于文档读取、创建和更新。可在语雀账户设置中生成。')",
    ".setDesc('用于文档读取、创建、更新，以及自动创建和管理同步知识库。可在语雀账户设置中生成。')",
    1,
)
settings_path.write_text(settings)

# README
readme_path = Path('README.md')
readme = readme_path.read_text()
readme = readme.replace("- **创建语雀文档**：当当前文件没有 `yuque_link` 时，在默认知识库中创建文档并自动写回链接", "- **创建语雀文档**：当当前文件没有 `yuque_link` 时，使用 Token 自动选择或创建私密知识库，并自动写回链接")
readme = readme.replace("- **批量推送未关联文档**：将没有 `yuque_link` 的 Markdown 文档串行创建到默认语雀知识库，并写回链接", "- **批量推送未关联文档**：将没有 `yuque_link` 的 Markdown 文档串行创建到自动管理的知识库池，并写回链接")
readme = readme.replace("- `Yuque Token`：用于读取、创建和更新语雀文档\n- `默认知识库`：格式为 `namespace/book`，仅在创建新文档时使用\n- `Yuque Cookie`：仅用于图片上传", "- `Yuque Token`：用于读取、创建和更新语雀文档，也用于自动识别账号并创建同步知识库\n- `Yuque Cookie`：仅用于图片上传")
readme = readme.replace("- 不存在 `yuque_link`：在默认知识库创建新文档，并将链接写回 YAML", "- 不存在 `yuque_link`：自动选择/创建有容量的私密知识库，并将链接写回 YAML")
anchor = "\n## 设置页同步控制中心\n"
section = """
## 自动知识库分片

从 1.3.3 开始，新建语雀文档不再要求用户配置 `namespace/book`。插件只需要 `Yuque Token`：

1. 通过语雀 OpenAPI `/user` 自动识别 Token 所属账号；
2. 查找带有 Yuque Sync 专用标记的托管知识库；
3. 首次没有托管库时自动创建私密的 `Obsidian Sync 001`；
4. 插件侧采用 4800 篇软上限，接近容量后自动创建 `Obsidian Sync 002`、`003`……；
5. 已有 `yuque_link` 的旧文档继续同步原知识库，不迁移；
6. 插件只自动管理自己创建并带专用描述标记的知识库，不会把用户其他知识库加入分片池。

知识库文档数会缓存在插件设置中，并在首次发现、缓存过期、接近软上限或创建文档疑似因容量失败时重新通过 OpenAPI 校验。批量推送会串行使用同一知识库池，因此跨过单库容量阈值时可以无人工干预地继续到下一库。

> 4800 是插件为了给语雀端手工创建、缓存误差和并发留余量而采用的安全软上限，不声明为语雀官方硬限制。
"""
if anchor not in readme:
    raise SystemExit('README insertion anchor missing')
readme = readme.replace(anchor, section + anchor, 1)
readme = readme.replace('公开资料常见的语雀小时限额为 5000 次；秒/分钟的当前硬限制请以语雀 OpenAPI 官方页面为准。', '秒/分钟/小时的当前硬限制请以语雀 OpenAPI 官方页面为准。')
readme_path.write_text(readme)

# tests
Path('tests/managed-book-pool.test.ts').write_text(r"""import { describe, expect, it } from 'vitest';
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
""")
