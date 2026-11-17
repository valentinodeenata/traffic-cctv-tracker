import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, nms } from './detect.mjs';

// Build a fake raw YOLOX output with one row set per entry.
function fakeOutput(rows) {
  const out = new Float32Array(3549 * 85);
  for (const { r, obj, cls, score, dx = 0.5, dy = 0.5, lw = 0, lh = 0 } of rows) {
    out.set([dx, dy, lw, lh, obj], r * 85);
    out[r * 85 + 5 + cls] = score;
  }
  return out;
}

test('decode: grid offsets, stride scaling, vehicle classes only, threshold', () => {
  const out = fakeOutput([
    { r: 53, obj: 0.9, cls: 2, score: 0.9 },     // stride 8, grid (1,1) -> centre (12,12), 8x8 box
    { r: 2704, obj: 0.9, cls: 6, score: 0.9 },   // first stride-16 cell -> centre (8,8); "train" counts as bus
    { r: 100, obj: 0.9, cls: 0, score: 0.99 },   // person: ignored
    { r: 200, obj: 0.5, cls: 2, score: 0.5 },    // 0.25 < 0.3: dropped
  ]);
  const boxes = decode(out, 3549);
  assert.equal(boxes.length, 2);
  const car = boxes.find((b) => b.cls === 'car');
  assert.deepEqual([car.x1, car.y1, car.x2, car.y2], [8, 8, 16, 16]);
  assert.equal(boxes.find((b) => b.cls === 'bus').x2, 16);
});

test('nms keeps the best of overlapping boxes, regardless of class', () => {
  const kept = nms([
    { x1: 0, y1: 0, x2: 10, y2: 10, score: 0.6, cls: 'truck' },
    { x1: 1, y1: 1, x2: 11, y2: 11, score: 0.9, cls: 'car' },
    { x1: 50, y1: 50, x2: 60, y2: 60, score: 0.4, cls: 'car' },
  ]);
  assert.deepEqual(kept.map((b) => b.score), [0.9, 0.4]);
});
