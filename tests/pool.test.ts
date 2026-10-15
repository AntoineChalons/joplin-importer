import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapLimit } from '../src/joplin/pool';

test('mapLimit keeps input order and respects the concurrency limit', async () => {
	let inFlight = 0;
	let maxInFlight = 0;
	const results = await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
		inFlight++;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise((resolve) => setTimeout(resolve, 6 - x));
		inFlight--;
		return x * 2;
	});
	assert.deepEqual(results, [2, 4, 6, 8, 10]);
	assert.ok(maxInFlight <= 2);
	assert.ok(maxInFlight >= 1);
});

test('mapLimit handles an empty list', async () => {
	assert.deepEqual(await mapLimit([], 4, async (x) => x), []);
});

test('mapLimit rejects when a call fails', async () => {
	await assert.rejects(
		mapLimit([1, 2, 3], 2, async (x) => {
			if (x === 2) throw new Error('boom');
			return x;
		}),
		/boom/,
	);
});
