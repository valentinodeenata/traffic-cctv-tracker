import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordPass, maintain, maintainIfDue, RETENTION } from './db.mjs';

const DAY = 86400;
const H = 3600;

test('recordPass stores successful counts only and tracks failures per camera', () => {
  const db = openDb(':memory:');
  recordPass(db, 1000, [{ id: 'a', ok: true, vehicles: 3 }, { id: 'b', ok: false, vehicles: null }], 9);
  recordPass(db, 1300, [{ id: 'a', ok: false, vehicles: null }, { id: 'b', ok: false, vehicles: null }], 9);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM readings').get().n, 1);
  const st = Object.fromEntries(db.prepare('SELECT * FROM camera_status').all().map((r) => [r.camera_id, r]));
  assert.deepEqual([st.a.last_ok, st.a.fails], [1000, 1]);
  assert.deepEqual([st.b.last_ok, st.b.fails], [null, 2]);
  assert.deepEqual({ ...db.prepare('SELECT online, total, vehicles FROM passes WHERE ts = 1000').get() }, { online: 1, total: 2, vehicles: 3 });
});

test('maintain rolls up complete hours and enforces retention', () => {
  const db = openDb(':memory:');
  const now = 400 * DAY; // aligned to an hour
  const ins = db.prepare('INSERT INTO readings (camera_id, ts, ok, vehicles) VALUES (?, ?, 1, ?)');
  ins.run('a', now - 2 * H, 2); ins.run('a', now - 2 * H + 300, 4); // complete hour -> avg 3, max 4
  ins.run('a', now - 60, 9);                                          // current hour: not rolled up yet
  ins.run('a', now - (RETENTION.RAW_DAYS + 1) * DAY, 1);              // too old for raw
  db.prepare('INSERT INTO hourly (camera_id, hour, samples, avg_vehicles, max_vehicles) VALUES (?, ?, 1, 1, 1)').run('a', Math.floor((now - (RETENTION.HOURLY_DAYS + 1) * DAY) / H));
  db.prepare('INSERT INTO passes VALUES (?, 1, 1, 1, 1)').run(now - (RETENTION.PASSES_DAYS + 1) * DAY);

  const removed = maintain(db, now);
  assert.deepEqual(removed, { readings: 1, hourly: 1, passes: 1 });
  const hr = db.prepare('SELECT * FROM hourly WHERE hour = ?').get(now / H - 2);
  assert.deepEqual([hr.samples, hr.avg_vehicles, hr.max_vehicles], [2, 3, 4]);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hourly WHERE hour = ?').get(now / H).n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM readings').get().n, 3);

  assert.equal(maintainIfDue(db, now + 60), null, 'runs at most once a day');
  assert.ok(maintainIfDue(db, now + DAY));
});
