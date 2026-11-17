// SQLite storage. The server keeps numbers only (no images), and keeps them bounded:
//   readings      raw 5-min counts, successful grabs only ......... RAW_DAYS
//   hourly        per-camera hourly rollup (baseline material) ..... HOURLY_DAYS
//   passes        one row per collector pass (health) .............. PASSES_DAYS
//   camera_status one row per camera, upserted (no history for dead cameras)
import { mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const RETENTION = { RAW_DAYS: 7, HOURLY_DAYS: 180, PASSES_DAYS: 90 };
const DAY = 86400;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS readings (
      camera_id TEXT NOT NULL, ts INTEGER NOT NULL, ok INTEGER NOT NULL, vehicles INTEGER
    );
    CREATE INDEX IF NOT EXISTS readings_cam_ts ON readings (camera_id, ts);
    CREATE INDEX IF NOT EXISTS readings_ts ON readings (ts);
    CREATE TABLE IF NOT EXISTS hourly (
      camera_id TEXT NOT NULL, hour INTEGER NOT NULL,      -- hour = unix seconds / 3600
      samples INTEGER NOT NULL, avg_vehicles REAL, max_vehicles INTEGER,
      PRIMARY KEY (camera_id, hour)
    );
    CREATE TABLE IF NOT EXISTS passes (
      ts INTEGER PRIMARY KEY, online INTEGER, total INTEGER, vehicles INTEGER, seconds INTEGER
    );
    CREATE TABLE IF NOT EXISTS camera_status (
      camera_id TEXT PRIMARY KEY, last_try INTEGER, last_ok INTEGER, fails INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);
  db.path = path;
  return db;
}

export function recordPass(db, ts, results, seconds) {
  const ins = db.prepare('INSERT INTO readings (camera_id, ts, ok, vehicles) VALUES (?, ?, 1, ?)');
  const status = db.prepare(`
    INSERT INTO camera_status (camera_id, last_try, last_ok, fails) VALUES (?, ?, ?, ?)
    ON CONFLICT (camera_id) DO UPDATE SET
      last_try = excluded.last_try,
      last_ok  = COALESCE(excluded.last_ok, last_ok),
      fails    = CASE WHEN excluded.last_ok IS NULL THEN fails + 1 ELSE 0 END`);
  db.exec('BEGIN');
  try {
    for (const { id, ok, vehicles } of results) {
      if (ok) ins.run(id, ts, vehicles);
      status.run(id, ts, ok ? ts : null, ok ? 0 : 1);
    }
    const online = results.filter((r) => r.ok);
    db.prepare('INSERT OR REPLACE INTO passes VALUES (?, ?, ?, ?, ?)')
      .run(ts, online.length, results.length, online.reduce((a, r) => a + (r.vehicles ?? 0), 0), seconds);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Roll up every complete hour that has raw rows, then drop data past retention.
export function maintain(db, now) {
  const currentHour = Math.floor(now / 3600);
  db.prepare(`
    INSERT OR REPLACE INTO hourly (camera_id, hour, samples, avg_vehicles, max_vehicles)
    SELECT camera_id, ts / 3600, COUNT(*), AVG(vehicles), MAX(vehicles)
    FROM readings WHERE ts / 3600 < ? AND ts >= ?
    GROUP BY camera_id, ts / 3600`).run(currentHour, now - (RETENTION.RAW_DAYS + 1) * DAY);
  const r = db.prepare('DELETE FROM readings WHERE ts < ?').run(now - RETENTION.RAW_DAYS * DAY);
  const h = db.prepare('DELETE FROM hourly WHERE hour < ?').run(Math.floor((now - RETENTION.HOURLY_DAYS * DAY) / 3600));
  const p = db.prepare('DELETE FROM passes WHERE ts < ?').run(now - RETENTION.PASSES_DAYS * DAY);
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // freed pages get reused, so the file stops growing
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('last_maintain', ?)").run(String(now));
  return { readings: r.changes, hourly: h.changes, passes: p.changes };
}

// Run maintain() at most once a day.
export function maintainIfDue(db, now) {
  const last = +(db.prepare("SELECT value FROM meta WHERE key = 'last_maintain'").get()?.value ?? 0);
  return now - last >= DAY ? maintain(db, now) : null;
}

export function dbBytes(db) {
  if (db.path === ':memory:') return 0;
  return [db.path, db.path + '-wal'].reduce((a, f) => { try { return a + statSync(f).size; } catch { return a; } }, 0);
}
