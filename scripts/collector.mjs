// Every 5 minutes: grab one frame per camera, count vehicles, store the counts.
// Frames are dropped after counting unless --save is given. Old data is pruned once a day (see db.mjs).
// With PORT set, the same process also serves the monitoring UI (see web.mjs).
// Run: node scripts/collector.mjs                 (loop)
//      node scripts/collector.mjs --once          (single pass + summary)
//      node scripts/collector.mjs --once --save   (also keep frames in snapshots/ for the accuracy check)
//      PORT=8790 node scripts/collector.mjs       (loop + UI on http://127.0.0.1:8790)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { grabFrame, pool, jpegSize } from './frame.mjs';
import { detectVehicles, normalizeBoxes } from './detect.mjs';
import { openDb, recordPass, maintainIfDue } from './db.mjs';

const SAVE = process.argv.includes('--save');
const INTERVAL_MS = 5 * 60 * 1000; // 1 frame / 5 min per camera keeps the load on owners' servers tiny
const CONCURRENCY = 8;

// On the server the DB lives outside the release dir so deploys don't wipe it.
const db = openDb(process.env.DB_PATH || 'data/traffic.db');
const loadCameras = () => JSON.parse(readFileSync('data/cameras.json', 'utf8'));
// Latest frame per camera, RAM only (~10 MB), overwritten every pass: lets the UI show what the AI counted.
const latest = new Map();

async function pass() {
  const cameras = loadCameras();
  const started = Date.now();
  const ts = Math.floor(started / 1000);
  const saveDir = `snapshots/${ts}`;
  if (SAVE) mkdirSync(saveDir, { recursive: true });
  const results = await pool(cameras, CONCURRENCY, async (cam) => {
    const frame = await grabFrame(cam);
    let vehicles = null;
    if (frame) {
      const boxes = await detectVehicles(frame).catch(() => null);
      vehicles = boxes?.length ?? null;
      const size = jpegSize(frame);
      if (boxes && size) latest.set(cam.id, { jpeg: frame, ts, ...size, boxes: normalizeBoxes(boxes, size.w, size.h) });
      if (SAVE) writeFileSync(`${saveDir}/${cam.id.replace(/[^\w.-]+/g, '_')}__${vehicles}.jpg`, frame);
    } else {
      latest.delete(cam.id);
    }
    return { id: cam.id, source: cam.source, ok: !!frame, vehicles };
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  recordPass(db, ts, results, seconds);
  const pruned = maintainIfDue(db, ts);

  const online = results.filter((r) => r.ok);
  console.log(`${new Date().toISOString()} ${online.length}/${cameras.length} online, ${online.reduce((a, r) => a + (r.vehicles ?? 0), 0)} vehicles, ${seconds}s`);
  if (pruned) console.log(`  pruned: ${JSON.stringify(pruned)}`);
}

if (process.env.PORT) (await import('./web.mjs')).serve(db, loadCameras, latest, +process.env.PORT);

if (process.argv.includes('--once')) {
  await pass();
  if (!process.env.PORT) process.exit(0);
} else {
  // ponytail: a pass that runs past 5 min just delays the next one; no overlap handling needed yet
  for (;;) {
    const t = Date.now();
    await pass().catch((e) => console.error('pass failed:', e));
    await new Promise((r) => setTimeout(r, Math.max(0, INTERVAL_MS - (Date.now() - t))));
  }
}
