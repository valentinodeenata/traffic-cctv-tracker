// Map UI + read-only JSON API, served by the collector process on 127.0.0.1 (Caddy proxies it).
// Responses carry Cache-Control so browsers reuse them instead of hitting the server again.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { RETENTION, dbBytes } from './db.mjs';
import { handle as routeApi } from './route.mjs';

const INDEX = new URL('../web/index.html', import.meta.url);

// state.levels: Map id -> { level, vehicles, stopped, usual } from levels.mjs, refreshed every pass
export function api(db, cameras, latest, state, path, params, now = Math.floor(Date.now() / 1000)) {
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
    const lastOk = new Map(db.prepare('SELECT camera_id, last_ok FROM camera_status').all().map((r) => [r.camera_id, r.last_ok]));
    return cameras.map((c) => {
      const l = state.levels.get(c.id);
      return {
        id: c.id, name: c.name, source: c.source, lat: c.lat, lng: c.lng, approx: !!c.approx,
        stream: c.stream, snapshot: c.snapshot,
        level: l?.level ?? 'offline', vehicles: l?.vehicles ?? null, stopped: l?.stopped ?? null,
        usual: l?.usual ? { vehicles: l.usual.vehicles, stopped: l.usual.stopped } : null,
        last_ok: lastOk.get(c.id) ?? null, frame: latest.has(c.id),
      };
    });
  }
  if (path === '/api/camera') {
    const id = params.get('id') ?? '';
    const f = latest.get(id);
    return {
      id,
      raw: db.prepare('SELECT ts, vehicles, stopped FROM readings WHERE camera_id = ? AND ts >= ? ORDER BY ts').all(id, now - 86400),
      hourly: db.prepare('SELECT hour, avg_vehicles, max_vehicles FROM hourly WHERE camera_id = ? AND hour >= ? ORDER BY hour')
        .all(id, Math.floor((now - 7 * 86400) / 3600)),
      frame: f ? { ts: f.ts, w: f.w, h: f.h, boxes: f.boxes } : null,
    };
  }
  return undefined;
}

const MAX_AGE = { '/api/summary': 30, '/api/cameras': 60, '/api/camera': 60 };

export function serve(db, loadCameras, latest, state, port) {
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
    if (url.pathname === '/api/route' || url.pathname === '/api/search') {
      return routeApi(url.pathname, url.searchParams, loadCameras()).then(({ status, body }) => {
        // Routes follow live traffic: short cache. Search results barely change.
        const age = status !== 200 ? 0 : url.pathname === '/api/route' ? 60 : 86400;
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': age ? `public, max-age=${age}` : 'no-store' });
        res.end(JSON.stringify(body));
      });
    }
    let body;
    try {
      body = api(db, loadCameras(), latest, state, url.pathname, url.searchParams);
    } catch (e) {
      console.error('api error:', e);
      return res.writeHead(500).end();
    }
    if (body === undefined) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${MAX_AGE[url.pathname]}` });
    res.end(JSON.stringify(body));
  }).listen(port, '127.0.0.1', () => console.log(`UI on http://127.0.0.1:${port}`));
}
