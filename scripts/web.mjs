// Monitoring UI + read-only JSON API, served by the collector process on 127.0.0.1 (Caddy proxies it).
// Responses carry Cache-Control so browsers reuse them instead of hitting the server again.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { RETENTION, dbBytes } from './db.mjs';

const INDEX = new URL('../web/index.html', import.meta.url);

export function api(db, cameras, path, params, now = Math.floor(Date.now() / 1000)) {
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
    const latest = new Map(db.prepare(`
      SELECT s.camera_id, s.last_ok, s.fails, r.vehicles FROM camera_status s
      LEFT JOIN readings r ON r.camera_id = s.camera_id AND r.ts = s.last_ok`).all().map((r) => [r.camera_id, r]));
    return cameras.map((c) => {
      const l = latest.get(c.id);
      return { id: c.id, name: c.name, source: c.source, lat: c.lat, lng: c.lng, snapshot: c.snapshot,
        last_ok: l?.last_ok ?? null, fails: l?.fails ?? null, vehicles: l?.vehicles ?? null };
    });
  }
  if (path === '/api/history') {
    const id = params.get('id') ?? '';
    return {
      id,
      raw: db.prepare('SELECT ts, vehicles FROM readings WHERE camera_id = ? AND ts >= ? ORDER BY ts').all(id, now - 86400),
      hourly: db.prepare('SELECT hour, avg_vehicles, max_vehicles FROM hourly WHERE camera_id = ? AND hour >= ? ORDER BY hour')
        .all(id, Math.floor((now - 7 * 86400) / 3600)),
    };
  }
  return undefined;
}

const MAX_AGE = { '/api/summary': 30, '/api/cameras': 60, '/api/history': 300 };

export function serve(db, loadCameras, port) {
  createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method !== 'GET') return res.writeHead(405).end();
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(readFileSync(INDEX));
    }
    let body;
    try {
      body = api(db, loadCameras(), url.pathname, url.searchParams);
    } catch (e) {
      console.error('api error:', e);
      return res.writeHead(500).end();
    }
    if (body === undefined) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${MAX_AGE[url.pathname]}` });
    res.end(JSON.stringify(body));
  }).listen(port, '127.0.0.1', () => console.log(`UI on http://127.0.0.1:${port}`));
}
