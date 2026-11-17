// Map UI + read-only JSON API, served by the collector process on 127.0.0.1 (Caddy proxies it).
// Responses carry Cache-Control so browsers reuse them instead of hitting the server again.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { RETENTION, dbBytes } from './db.mjs';

const INDEX = new URL('../web/index.html', import.meta.url);
const ONLINE_WINDOW = 15 * 60; // a camera counts as live if it answered in the last 15 min

// Traffic level from the latest count vs. this camera's own average.
// Floors keep a quiet camera from turning "padat" over two cars; with no history yet the floors decide alone.
// ponytail: plain 7-day average; switch to an hour-of-week baseline once a few weeks of hourly data exist.
export function levelOf(vehicles, avg) {
  if (vehicles == null) return 'offline';
  if (vehicles >= Math.max(6, avg * 2)) return 'padat';
  if (vehicles >= Math.max(3, avg * 1.3)) return 'ramai';
  return 'lancar';
}

const MIN_SAMPLES = 12; // an hour of 5-min readings before trusting a camera's own average

function averages(db, now) {
  return new Map(db.prepare(`
    SELECT camera_id, AVG(vehicles) avg, COUNT(*) n FROM readings
    WHERE ts >= ? AND vehicles IS NOT NULL GROUP BY camera_id`).all(now - RETENTION.RAW_DAYS * 86400)
    .map((r) => [r.camera_id, r.n >= MIN_SAMPLES ? r.avg : 0]));
}

export function api(db, cameras, latest, path, params, now = Math.floor(Date.now() / 1000)) {
  if (path === '/api/summary') {
    const last = db.prepare('SELECT * FROM passes ORDER BY ts DESC LIMIT 1').get() ?? null;
    const status = new Map(db.prepare('SELECT camera_id, last_ok FROM camera_status').all().map((r) => [r.camera_id, r.last_ok]));
    const sources = {};
    for (const c of cameras) {
      const s = (sources[c.source] ??= { source: c.source, online: 0, total: 0 });
      s.total++;
      if (last && status.get(c.id) === last.ts) s.online++;
    }
    return {
      now,
      last_pass: last,
      passes: db.prepare('SELECT ts, online, vehicles, seconds FROM passes WHERE ts >= ? ORDER BY ts').all(now - 86400),
      sources: Object.values(sources).sort((a, b) => b.total - a.total),
      storage: {
        bytes: dbBytes(db),
        readings: db.prepare('SELECT COUNT(*) n FROM readings').get().n,
        hourly: db.prepare('SELECT COUNT(*) n FROM hourly').get().n,
        passes: db.prepare('SELECT COUNT(*) n FROM passes').get().n,
        last_maintain: +(db.prepare("SELECT value FROM meta WHERE key = 'last_maintain'").get()?.value ?? 0) || null,
        retention: RETENTION,
      },
    };
  }
  if (path === '/api/cameras') {
    const st = new Map(db.prepare(`
      SELECT s.camera_id, s.last_ok, r.vehicles FROM camera_status s
      LEFT JOIN readings r ON r.camera_id = s.camera_id AND r.ts = s.last_ok`).all().map((r) => [r.camera_id, r]));
    const avg = averages(db, now);
    return cameras.map((c) => {
      const s = st.get(c.id);
      const live = s?.last_ok != null && now - s.last_ok < ONLINE_WINDOW;
      const a = avg.get(c.id) ?? 0;
      return {
        id: c.id, name: c.name, source: c.source, lat: c.lat, lng: c.lng, approx: !!c.approx,
        stream: c.stream, snapshot: c.snapshot,
        vehicles: live ? s.vehicles : null, avg: +a.toFixed(1), level: levelOf(live ? s.vehicles : null, a),
        last_ok: s?.last_ok ?? null, frame: latest.has(c.id),
      };
    });
  }
  if (path === '/api/camera') {
    const id = params.get('id') ?? '';
    const f = latest.get(id);
    return {
      id,
      raw: db.prepare('SELECT ts, vehicles FROM readings WHERE camera_id = ? AND ts >= ? ORDER BY ts').all(id, now - 86400),
      hourly: db.prepare('SELECT hour, avg_vehicles, max_vehicles FROM hourly WHERE camera_id = ? AND hour >= ? ORDER BY hour')
        .all(id, Math.floor((now - 7 * 86400) / 3600)),
      frame: f ? { ts: f.ts, w: f.w, h: f.h, boxes: f.boxes } : null,
    };
  }
  return undefined;
}

const MAX_AGE = { '/api/summary': 30, '/api/cameras': 60, '/api/camera': 60 };

export function serve(db, loadCameras, latest, port) {
  createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method !== 'GET') return res.writeHead(405).end();
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(INDEX));
    }
    if (url.pathname === '/api/frame') {
      const f = latest.get(url.searchParams.get('id') ?? '');
      if (!f) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=60' });
      return res.end(f.jpeg);
    }
    let body;
    try {
      body = api(db, loadCameras(), latest, url.pathname, url.searchParams);
    } catch (e) {
      console.error('api error:', e);
      return res.writeHead(500).end();
    }
    if (body === undefined) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${MAX_AGE[url.pathname]}` });
    res.end(JSON.stringify(body));
  }).listen(port, '127.0.0.1', () => console.log(`UI on http://127.0.0.1:${port}`));
}
