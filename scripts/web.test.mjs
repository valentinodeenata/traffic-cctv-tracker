import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordPass } from './db.mjs';
import { api } from './web.mjs';

test('api: summary counts online per source from the last pass, cameras carry latest count', () => {
  const db = openDb(':memory:');
  const cameras = [
    { id: 'a', name: 'A', source: 'S1', lat: -6.2, lng: 106.8, snapshot: null },
    { id: 'b', name: 'B', source: 'S1', lat: null, lng: null, snapshot: null },
    { id: 'c', name: 'C', source: 'S2', lat: null, lng: null, snapshot: null },
  ];
  recordPass(db, 1000, [{ id: 'a', ok: true, vehicles: 2 }, { id: 'b', ok: true, vehicles: 1 }, { id: 'c', ok: true, vehicles: 0 }], 5);
  recordPass(db, 1300, [{ id: 'a', ok: true, vehicles: 7 }, { id: 'b', ok: false }, { id: 'c', ok: false }], 5);

  const s = api(db, cameras, '/api/summary', new URLSearchParams(), 1400);
  assert.equal(s.last_pass.ts, 1300);
  assert.deepEqual(s.sources, [{ source: 'S1', online: 1, total: 2 }, { source: 'S2', online: 0, total: 1 }]);
  assert.equal(s.storage.readings, 4);

  const cams = Object.fromEntries(api(db, cameras, '/api/cameras', new URLSearchParams(), 1400).map((c) => [c.id, c]));
  assert.deepEqual([cams.a.vehicles, cams.a.last_ok], [7, 1300]);
  assert.deepEqual([cams.b.vehicles, cams.b.last_ok, cams.b.fails], [1, 1000, 1]); // last good count kept

  const h = api(db, cameras, '/api/history', new URLSearchParams('id=a'), 1400);
  assert.deepEqual(h.raw.map((r) => r.vehicles), [2, 7]);
  assert.equal(api(db, cameras, '/api/nope', new URLSearchParams()), undefined);
});
