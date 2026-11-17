// Every 5 minutes: grab one frame per camera and log the result to SQLite.
// Run: node scripts/collector.mjs          (loop)
//      node scripts/collector.mjs --once   (single pass + summary)
import { readFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { grabFrame, pool } from './frame.mjs';

const INTERVAL_MS = 5 * 60 * 1000; // 1 frame / 5 min per camera keeps the load on owners' servers tiny
const CONCURRENCY = 8;

mkdirSync('data', { recursive: true });
const db = new DatabaseSync('data/traffic.db');
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
  const results = await pool(cameras, CONCURRENCY, async (cam) => {
    const frame = await grabFrame(cam);
    insert.run(cam.id, ts, frame ? 1 : 0, null);
    return { cam, ok: !!frame };
  });

  const bySource = {};
  for (const { cam, ok } of results) {
    const s = (bySource[cam.source] ??= { ok: 0, total: 0 });
    s.total++; if (ok) s.ok++;
  }
  const online = results.filter((r) => r.ok).length;
  console.log(`${new Date().toISOString()} ${online}/${cameras.length} online in ${Math.round((Date.now() - started) / 1000)}s`);
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
