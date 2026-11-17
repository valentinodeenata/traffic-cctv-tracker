import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordPass } from './db.mjs';
import { api, levelOf } from './web.mjs';

test('levelOf: floors for quiet cameras, relative to the camera once it has history', () => {
  assert.equal(levelOf(null, 5), 'offline');
  assert.equal(levelOf(2, 0), 'lancar');
  assert.equal(levelOf(3, 0), 'ramai');
  assert.equal(levelOf(6, 0), 'padat');
  assert.equal(levelOf(8, 6), 'ramai');   // busy road: 8 is normal-ish (< 2x of 6)
  assert.equal(levelOf(12, 6), 'padat');
  assert.equal(levelOf(5, 6), 'lancar');
});

test('api: summary per source, cameras carry level and live state, detail returns frame boxes', () => {
  const db = openDb(':memory:');
  const cameras = [
    { id: 'a', name: 'A', source: 'S1', lat: -6.2, lng: 106.8, stream: 'https://x/a.m3u8', snapshot: null },
    { id: 'b', name: 'B', source: 'S1', lat: -6.3, lng: 106.9, stream: 'https://x/b.m3u8', snapshot: null, approx: true },
    { id: 'c', name: 'C', source: 'S2', lat: null, lng: null, stream: 'https://x/c.m3u8', snapshot: null },
  ];
  recordPass(db, 1000, [{ id: 'a', ok: true, vehicles: 2 }, { id: 'b', ok: true, vehicles: 1 }, { id: 'c', ok: true, vehicles: 0 }], 5);
  recordPass(db, 1300, [{ id: 'a', ok: true, vehicles: 7 }, { id: 'b', ok: false }, { id: 'c', ok: false }], 5);
  const latest = new Map([['a', { jpeg: Buffer.from('x'), ts: 1300, w: 640, h: 360, boxes: [{ x1: 0, y1: 0, x2: 1, y2: 1, cls: 'car', score: 0.9 }] }]]);

  const s = api(db, cameras, latest, '/api/summary', new URLSearchParams(), 1400);
  assert.equal(s.last_pass.ts, 1300);
  assert.deepEqual(s.sources, [{ source: 'S1', online: 1, total: 2 }, { source: 'S2', online: 0, total: 1 }]);

  const cams = Object.fromEntries(api(db, cameras, latest, '/api/cameras', new URLSearchParams(), 1400).map((c) => [c.id, c]));
  assert.deepEqual([cams.a.vehicles, cams.a.level, cams.a.frame], [7, 'padat', true]);
  assert.deepEqual([cams.b.level, cams.b.approx], ['lancar', true]); // last ok 400 s ago: still live
  assert.equal(api(db, cameras, latest, '/api/cameras', new URLSearchParams(), 1000 + 3600).find((c) => c.id === 'b').level, 'offline');

  const d = api(db, cameras, latest, '/api/camera', new URLSearchParams('id=a'), 1400);
  assert.deepEqual(d.raw.map((r) => r.vehicles), [2, 7]);
  assert.equal(d.frame.boxes.length, 1);
  assert.equal(api(db, cameras, latest, '/api/camera', new URLSearchParams('id=c'), 1400).frame, null);
  assert.equal(api(db, cameras, latest, '/api/nope', new URLSearchParams()), undefined);
});
