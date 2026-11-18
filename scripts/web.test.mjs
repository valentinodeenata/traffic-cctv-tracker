import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordPass } from './db.mjs';
import { computeLevels } from './levels.mjs';
import { api } from './web.mjs';

test('api: summary per source, cameras carry level and motion, detail returns frame boxes', () => {
  const db = openDb(':memory:');
  const cameras = [
    { id: 'a', name: 'A', source: 'S1', lat: -6.2, lng: 106.8, stream: 'https://x/a.m3u8', snapshot: null },
    { id: 'b', name: 'B', source: 'S1', lat: -6.3, lng: 106.9, stream: 'https://x/b.m3u8', snapshot: null, approx: true },
    { id: 'c', name: 'C', source: 'S2', lat: null, lng: null, stream: 'https://x/c.m3u8', snapshot: null },
  ];
  recordPass(db, 700, [{ id: 'a', ok: true, vehicles: 9, stopped: 7 }], 5);
  recordPass(db, 1000, [{ id: 'a', ok: true, vehicles: 9, stopped: 8 }, { id: 'b', ok: true, vehicles: 1, stopped: 0 }, { id: 'c', ok: true, vehicles: 0 }], 5);
  recordPass(db, 1300, [{ id: 'a', ok: true, vehicles: 10, stopped: 9 }, { id: 'b', ok: false }, { id: 'c', ok: false }], 5);
  const latest = new Map([['a', { jpeg: Buffer.from('x'), ts: 1300, w: 640, h: 360, boxes: [{ x1: 0, y1: 0, x2: 1, y2: 1, cls: 'car', score: 0.9, stopped: true }] }]]);
  const state = { levels: computeLevels(db, 1400) };
  const call = (path, q = '') => api(db, cameras, latest, state, path, new URLSearchParams(q), 1400);

  const s = call('/api/summary');
  assert.equal(s.last_pass.ts, 1300);
  assert.deepEqual(s.sources, [{ source: 'S1', online: 1, total: 2 }, { source: 'S2', online: 0, total: 1 }]);

  const cams = Object.fromEntries(call('/api/cameras').map((c) => [c.id, c]));
  assert.deepEqual([cams.a.level, cams.a.vehicles, cams.a.stopped, cams.a.frame], ['padat', 10, 9, true]); // standing still three passes running
  assert.deepEqual([cams.b.level, cams.b.approx], ['lancar', true]);
  assert.equal(cams.c.level, 'lancar');

  const d = call('/api/camera', 'id=a');
  assert.deepEqual(d.raw.map((r) => r.stopped), [7, 8, 9]);
  assert.equal(d.frame.boxes[0].stopped, true);
  assert.equal(call('/api/camera', 'id=c').frame, null);
  assert.equal(call('/api/nope'), undefined);
});
