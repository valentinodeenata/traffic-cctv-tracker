import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode, nms, normalizeBoxes, motion } from './detect.mjs';

test('motion: in-place vehicles are stopped, shifted or vanished ones are moving', () => {
  const box = (x, y, w = 40) => ({ x1: x, y1: y, x2: x + w, y2: y + 20, score: 0.9, cls: 'car' });
  const a = [box(0, 0), box(100, 0), box(200, 0), box(300, 0)];
  const b = [box(3, 1), box(115, 0), box(300, 0)];  // 1st barely moved; 2nd moved 15 px (> 0.25 x 40); 3rd gone
  assert.deepEqual(motion(a, b).map((x) => x.stopped), [true, false, false, true]);
  assert.deepEqual(motion(a, []).map((x) => x.stopped), [false, false, false, false]);
});

test('normalizeBoxes maps letterboxed coords back to the original image', () => {
  // 640x360 -> scale 0.65 -> 416x234 at top-left
  const [b] = normalizeBoxes([{ x1: 0, y1: 0, x2: 208, y2: 234, cls: 'car', score: 0.91234 }], 640, 360, 416);
  assert.deepEqual(b, { x1: 0, y1: 0, x2: 0.5, y2: 1, cls: 'car', score: 0.91, stopped: false });
});

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
    { r: 2704, obj: 0.9, cls: 5, score: 0.9 },   // first stride-16 cell -> centre (8,8), bus
    { r: 2705, obj: 0.9, cls: 6, score: 0.95 },  // train: ignored
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
