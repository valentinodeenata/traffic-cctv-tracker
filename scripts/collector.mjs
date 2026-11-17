// Every 5 minutes: grab one frame per camera, count vehicles, log the count to SQLite.
// Frames are dropped after counting unless --save is given.
// Run: node scripts/collector.mjs                 (loop)
//      node scripts/collector.mjs --once          (single pass + summary)
//      node scripts/collector.mjs --once --save   (also keep frames in snapshots/ for the accuracy check)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { grabFrame, pool } from './frame.mjs';
import { detectVehicles } from './detect.mjs';

const SAVE = process.argv.includes('--save');

const INTERVAL_MS = 5 * 60 * 1000; // 1 frame / 5 min per camera keeps the load on owners' servers tiny
const CONCURRENCY = 8;

// On the server the DB lives outside the release dir so deploys don't wipe it.
const DB_PATH = process.env.DB_PATH || 'data/traffic.db';
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS readings (
    camera_id TEXT NOT NULL,
    ts        INTEGER NOT NULL,  -- unix seconds
    ok        INTEGER NOT NULL,  -- 1 = frame received
    vehicles  INTEGER            -- filled in once detection is wired up
  );
  CREATE INDEX IF NOT EXISTS readings_cam_ts ON readings (camera_id, ts);
`);
const insert = db.prepare('INSERT INTO readings (camera_id, ts, ok, vehicles) VALUES (?, ?, ?, ?)');

async function pass() {
  const cameras = JSON.parse(readFileSync('data/cameras.json', 'utf8'));
  const started = Date.now();
  const ts = Math.floor(started / 1000);
  const saveDir = `snapshots/${ts}`;
  if (SAVE) mkdirSync(saveDir, { recursive: true });
  const results = await pool(cameras, CONCURRENCY, async (cam) => {
    const frame = await grabFrame(cam);
    let vehicles = null;
    if (frame) {
      vehicles = (await detectVehicles(frame).catch(() => null))?.length ?? null;
      if (SAVE) writeFileSync(`${saveDir}/${cam.id.replace(/[^\w.-]+/g, '_')}__${vehicles}.jpg`, frame);
    }
    insert.run(cam.id, ts, frame ? 1 : 0, vehicles);
    return { cam, ok: !!frame, vehicles };
  });

  const bySource = {};
  for (const { cam, ok } of results) {
    const s = (bySource[cam.source] ??= { ok: 0, total: 0 });
    s.total++; if (ok) s.ok++;
  }
  const online = results.filter((r) => r.ok).length;
  const counted = results.filter((r) => r.vehicles != null);
  const total = counted.reduce((a, r) => a + r.vehicles, 0);
  console.log(`${new Date().toISOString()} ${online}/${cameras.length} online, ${total} vehicles across ${counted.length} cameras, ${Math.round((Date.now() - started) / 1000)}s`);
  for (const [src, s] of Object.entries(bySource).sort()) console.log(`  ${String(s.ok).padStart(4)}/${String(s.total).padEnd(4)} ${src}`);
}

if (process.argv.includes('--once')) {
  await pass();
} else {
  // ponytail: a pass that runs past 5 min just delays the next one; no overlap handling needed yet
  for (;;) {
    const t = Date.now();
    await pass().catch((e) => console.error('pass failed:', e));
    await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - t))));
  }
}
