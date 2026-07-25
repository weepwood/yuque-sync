import { parseYaml } from 'obsidian';
import type { ImageReference, YuqueLocation } from './types';

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const REMOTE_RESOURCE_PATTERN = /^(?:https?:|data:|blob:)/i;

export function extractYuqueLocation(value: string): YuqueLocation | null {
	try {
		const url = new URL(value.trim());
		if (url.protocol !== 'https:' || !['www.yuque.com', 'yuque.com'].includes(url.hostname)) {
			return null;
		}

		const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
		if (segments.length < 3) {
			return null;
		}

		return {
			bookId: `${segments[0]}/${segments[1]}`,
			slug: segments[2],
		};
	} catch {
		return null;
	}
}

export function normalizeBookId(value: string): string | null {
	const segments = value.trim().split('/').filter(Boolean);
	return segments.length === 2 ? `${segments[0]}/${segments[1]}` : null;
}

export function splitMarkdown(content: string): { frontmatterBlock: string; body: string } {
	const match = content.match(FRONTMATTER_PATTERN);
	if (!match) {
		return { frontmatterBlock: '', body: content };
	}

	return {
		frontmatterBlock: match[0].replace(/\r?\n$/, ''),
		body: content.slice(match[0].length),
	};
}

export function readFrontmatter(content: string): Record<string, unknown> {
	const match = content.match(FRONTMATTER_PATTERN);
	if (!match) {
		return {};
	}

	try {
		const parsed = parseYaml(match[1]);
		return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
	} catch (error) {
		console.error('[Yuque Sync] 无法解析 YAML 前置元数据', error);
		return {};
	}
}

export function getStringProperty(source: Record<string, unknown>, key: string): string | null {
	const value = source[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function findImageReferences(content: string): ImageReference[] {
	const references: ImageReference[] = [];
	const markdownPattern = /!\[[^\]]*\]\(([^)\n]+)\)/g;
	let match: RegExpExecArray | null;

	while ((match = markdownPattern.exec(content)) !== null) {
		const rawTarget = match[1];
		const leadingWhitespace = rawTarget.length - rawTarget.trimStart().length;
		const target = rawTarget.trim();
		let path = target;
		let offsetInTarget = leadingWhitespace;

		if (target.startsWith('<')) {
			const closingBracket = target.indexOf('>');
			if (closingBracket > 1) {
				path = target.slice(1, closingBracket);
				offsetInTarget += 1;
			}
		} else {
			const titleMatch = target.match(/\s+(?:"[^"]*"|'[^']*')\s*$/);
			if (titleMatch?.index !== undefined) {
				path = target.slice(0, titleMatch.index).trimEnd();
			}
		}

		if (!path || REMOTE_RESOURCE_PATTERN.test(path)) {
			continue;
		}

		const targetStart = match.index + match[0].indexOf(rawTarget);
		references.push({
			path,
			pathStart: targetStart + offsetInTarget,
			pathEnd: targetStart + offsetInTarget + path.length,
			fullStart: match.index,
			fullEnd: match.index + match[0].length,
		});
	}

	const wikiPattern = /!\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
	while ((match = wikiPattern.exec(content)) !== null) {
		const path = match[1].trim();
		if (!path || REMOTE_RESOURCE_PATTERN.test(path)) {
			continue;
		}

		const pathStart = match.index + match[0].indexOf(match[1]) + (match[1].length - match[1].trimStart().length);
		references.push({
			path,
			pathStart,
			pathEnd: pathStart + path.length,
			fullStart: match.index,
			fullEnd: match.index + match[0].length,
		});
	}

	return references.sort((left, right) => left.pathStart - right.pathStart);
}

export function replaceImageReferences(
	content: string,
	references: ImageReference[],
	replacements: ReadonlyMap<string, string>,
): string {
	let result = content;
	for (const reference of [...references].sort((left, right) => right.pathStart - left.pathStart)) {
		const replacement = replacements.get(reference.path);
		if (!replacement) {
			continue;
		}
		result = `${result.slice(0, reference.pathStart)}${replacement}${result.slice(reference.pathEnd)}`;
	}
	return result;
}

export function safeDecodeURIComponent(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function formatFileTimestamp(date: Date): string {
	const pad = (value: number) => value.toString().padStart(2, '0');
	return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function describeError(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (typeof error === 'string') {
		return error;
	}
	return '未知错误';
}
