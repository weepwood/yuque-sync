export interface YuqueSyncSettings {
	yuqueToken: string;
	defaultBookId: string;
	yuqueCookie: string;
}

export const DEFAULT_SETTINGS: YuqueSyncSettings = {
	yuqueToken: '',
	defaultBookId: '',
	yuqueCookie: '',
};

export interface YuqueLocation {
	bookId: string;
	slug: string;
}

export interface YuqueDocument {
	title: string;
	content: string;
	updatedAt: string;
}

export interface CreatedYuqueDocument {
	id: number;
	slug: string;
}

export interface ImageReference {
	kind: 'markdown' | 'wiki';
	path: string;
	pathStart: number;
	pathEnd: number;
	fullStart: number;
	fullEnd: number;
}
