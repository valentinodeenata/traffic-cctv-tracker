import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, recordPass } from './db.mjs';
import { levelFor, computeLevels, usualByCamera, markModel } from './levels.mjs';

test('switching the detection model restarts the baseline', () => {
  const db = openDb(':memory:');
  const DAY = 86400, now = 100 * DAY;
  markModel(db, 'yolox_nano', 0);
  for (let d = 1; d <= 3; d++) for (let m = 0; m < 3; m++) recordPass(db, now - d * DAY + m * 300, [{ id: 'a', ok: true, vehicles: 2, stopped: 0 }], 1);
  assert.equal(usualByCamera(db, now).get('a').vehicles, 2);
  markModel(db, 'yolox_nano', now - 3600); // same model again: no reset
  assert.equal(usualByCamera(db, now).get('a').vehicles, 2);
  markModel(db, 'yolox_s', now - 3600);    // new model: old counts no longer count
  assert.equal(usualByCamera(db, now).get('a'), undefined);
});

const r = (vehicles, stopped) => ({ vehicles, stopped });

test('levelFor: the cases from the field', () => {
  // Night, Senayan: 6 moving cars on an empty-looking road -> not padat, not even ramai
  assert.equal(levelFor([r(6, 0)], null), 'lancar');
  // Traffic light: one pass catches a red-light queue -> ramai at most
  assert.equal(levelFor([r(10, 6), r(9, 1), r(8, 2)], { vehicles: 8, stopped: 2 }), 'ramai');
  // Same light, queue normal for this camera (usual stopped 4) -> stays lancar
  assert.equal(levelFor([r(10, 6), r(9, 5), r(8, 6)], { vehicles: 9, stopped: 4 }), 'lancar');
  // Real jam: most vehicles standing still for two passes in a row -> padat
  assert.equal(levelFor([r(14, 10), r(12, 9), r(9, 2)], { vehicles: 6, stopped: 1 }), 'padat');
  // No stopped baseline yet (first hours of data): two red lights in a row is not enough, three is
  assert.equal(levelFor([r(12, 8), r(11, 7), r(9, 1)], { vehicles: 7, stopped: null }), 'ramai');
  assert.equal(levelFor([r(12, 8), r(11, 7), r(10, 6)], { vehicles: 7, stopped: null }), 'padat');
  // Busy but flowing: far more cars than usual, nearly all moving -> ramai
  assert.equal(levelFor([r(15, 2)], { vehicles: 6, stopped: 1 }), 'ramai');
  // Only one frame available (stopped unknown) can never be padat
  assert.equal(levelFor([r(20, null), r(20, null)], { vehicles: 6, stopped: null }), 'ramai');
  // No baseline yet (new camera, or just after a model switch): a big count alone proves nothing
  assert.equal(levelFor([r(20, 3)], null), 'lancar');
  assert.equal(levelFor([], null), 'offline');
});

test('computeLevels: uses this hour of day as the baseline and only live cameras', () => {
  const db = openDb(':memory:');
  const DAY = 86400, now = 100 * DAY + 3 * 3600; // 10:00 WIB
  // A week of normal mornings at a traffic light: ~9 visible, ~5 stopped
  for (let d = 1; d <= 6; d++) for (let m = 0; m < 3; m++) recordPass(db, now - d * DAY + m * 300, [{ id: 'light', ok: true, vehicles: 9, stopped: 5 }], 1);
  // Nights are empty: must not drag the morning baseline down
  for (let d = 1; d <= 6; d++) recordPass(db, now - d * DAY + 12 * 3600, [{ id: 'light', ok: true, vehicles: 0, stopped: 0 }], 1);
  assert.deepEqual({ ...usualByCamera(db, now).get('light') }, { vehicles: 9, stopped: 5, samples: 18 });

  recordPass(db, now - 600, [{ id: 'light', ok: true, vehicles: 10, stopped: 6 }, { id: 'gone', ok: true, vehicles: 3, stopped: 0 }], 1);
  recordPass(db, now - 300, [{ id: 'light', ok: true, vehicles: 11, stopped: 7 }, { id: 'gone', ok: false }], 1);
  recordPass(db, now, [{ id: 'light', ok: true, vehicles: 10, stopped: 6 }, { id: 'gone', ok: false }], 1);
  const lv = computeLevels(db, now + 60);
  assert.equal(lv.get('light').level, 'lancar'); // its usual morning queue
  assert.equal(lv.get('gone').level, 'lancar');  // last ok 11 min ago: still live
  assert.equal(computeLevels(db, now + 20 * 60).size, 0); // nothing answered in 15 min
});
