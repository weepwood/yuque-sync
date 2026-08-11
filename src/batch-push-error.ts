export interface BatchPushFailureDetails {
	filePath: string;
	index: number;
	total: number;
	success: number;
	recovered: number;
	skipped: number;
	tocFailed: number;
	error: unknown;
}

function describeBatchPushError(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	if (typeof error === 'string' && error.trim()) return error.trim();
	return '未知错误';
}

export function createBatchPushFailure(details: BatchPushFailureDetails): Error {
	const position = Math.min(Math.max(details.index + 1, 1), Math.max(details.total, 1));
	const remaining = Math.max(0, details.total - details.index - 1);
	const stats = [`已成功 ${details.success} 篇`];
	if (details.recovered > 0) stats.push(`恢复关联 ${details.recovered} 篇`);
	if (details.skipped > 0) stats.push(`跳过 ${details.skipped} 篇`);
	if (details.tocFailed > 0) stats.push(`目录加入失败 ${details.tocFailed} 篇`);
	stats.push(`剩余 ${remaining} 篇未执行`);

	const failure = new Error(
		`批量推送已停止：第 ${position}/${details.total} 篇「${details.filePath}」推送失败。` +
		`错误：${describeBatchPushError(details.error)}。${stats.join('，')}。`,
	);
	failure.name = 'BatchPushError';
	return failure;
}
