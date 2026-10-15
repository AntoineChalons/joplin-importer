/** Map over items with at most `limit` calls in flight. Results keep the input order. */
export async function mapLimit<T, R>(
	items: readonly T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;

	const worker = async (): Promise<void> => {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await fn(items[i] as T, i);
		}
	};

	const workers = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: workers }, () => worker()));
	return results;
}
