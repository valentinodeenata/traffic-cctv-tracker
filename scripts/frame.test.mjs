import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJpeg, pool } from './frame.mjs';

test('isJpeg checks the magic bytes', () => {
  assert.ok(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(!isJpeg(Buffer.from('<html>')));
  assert.ok(!isJpeg(null));
});

test('pool keeps order and caps concurrency', async () => {
  let live = 0, peak = 0;
  const out = await pool([5, 1, 3, 2, 4], 2, async (x) => {
    peak = Math.max(peak, ++live);
    await new Promise((r) => setTimeout(r, x));
    live--;
    return x * 10;
  });
  assert.deepEqual(out, [50, 10, 30, 20, 40]);
  assert.equal(peak, 2);
});
