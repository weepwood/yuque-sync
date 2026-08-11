import { describe, expect, it } from 'vitest';
import { createBatchPushFailure } from '../src/batch-push-error';

describe('createBatchPushFailure', () => {
	it('includes the failed file, original error and remaining work in the message', () => {
		const failure = createBatchPushFailure({
			filePath: 'Notes/failing.md',
			index: 2,
			total: 10,
			success: 2,
			recovered: 1,
			skipped: 0,
			tocFailed: 1,
			error: new Error('HTTP 422: repository full'),
		});

		expect(failure.name).toBe('BatchPushError');
		expect(failure.message).toContain('第 3/10 篇');
		expect(failure.message).toContain('Notes/failing.md');
		expect(failure.message).toContain('HTTP 422: repository full');
		expect(failure.message).toContain('已成功 2 篇');
		expect(failure.message).toContain('恢复关联 1 篇');
		expect(failure.message).toContain('目录加入失败 1 篇');
		expect(failure.message).toContain('剩余 7 篇未执行');
	});

	it('reports zero remaining documents when the last document fails', () => {
		const failure = createBatchPushFailure({
			filePath: 'last.md',
			index: 4,
			total: 5,
			success: 4,
			recovered: 0,
			skipped: 0,
			tocFailed: 0,
			error: 'network unavailable',
		});

		expect(failure.message).toContain('第 5/5 篇');
		expect(failure.message).toContain('network unavailable');
		expect(failure.message).toContain('剩余 0 篇未执行');
	});
});
