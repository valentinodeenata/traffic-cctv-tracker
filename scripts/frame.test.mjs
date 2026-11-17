import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isJpeg, pool, jpegSize } from './frame.mjs';

test('isJpeg checks the magic bytes', () => {
  assert.ok(isJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(!isJpeg(Buffer.from('<html>')));
  assert.ok(!isJpeg(null));
});

test('jpegSize reads dimensions from the SOF marker, skipping other segments', () => {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];                       // 2-byte payload
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x68, 0x02, 0x80, 0x03, ...Array(9).fill(0)]; // 360 x 640
  const buf = Buffer.from([0xff, 0xd8, ...app0, ...sof0]);
  assert.deepEqual(jpegSize(buf), { w: 640, h: 360 });
  assert.equal(jpegSize(Buffer.from([0xff, 0xd8, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0])), null);
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
