// Routes with live traffic and address search, through TomTom. The API key stays on the server.
//
// Free tier (checked 2026-11-18, docs.tomtom.com/pricing): routing 20k/month, search 2.5k/month, no card,
// over the limit TomTom answers 429. Daily caps below keep us inside that; the same request within a few
// minutes is answered from memory.
// ponytail: one global daily cap, no per-visitor limit; add one if a single visitor starts eating the quota.

export const DAILY = { route: 600, search: 80 };
const TTL = { route: 3 * 60_000, search: 24 * 3600_000 };
const MEMO_MAX = 500;
const used = { day: '', route: 0, search: 0 };
const memo = new Map(); // url -> { at, data }

// Rough box around Jabodetabek plus margin: keeps the quota for the area this map covers.
const inArea = (p) => p && p.lat > -7.2 && p.lat < -5.8 && p.lng > 106.0 && p.lng < 107.6;
const point = (s) => {
  const [lat, lng] = String(s ?? '').split(',').map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
};

// TomTom traffic sections: magnitudeOfDelay 0 unknown, 1 minor, 2 moderate, 3 major, 4 undefined (closures)
const JAM = { 0: 'ramai', 1: 'ramai', 2: 'padat', 3: 'macet', 4: 'macet' };

export function parseRoutes(data) {
  return (data.routes ?? []).map((r) => {
    const coords = r.legs.flatMap((l) => l.points).map((p) => [+p.longitude.toFixed(5), +p.latitude.toFixed(5)]);
    const spans = (r.sections ?? []).filter((s) => s.sectionType === 'TRAFFIC')
      .map((s) => ({ from: s.startPointIndex, to: s.endPointIndex, level: JAM[s.magnitudeOfDelay] ?? 'ramai', delay: s.delayInSeconds ?? 0 }));
    const s = r.summary;
    return { meters: s.lengthInMeters, seconds: s.travelTimeInSeconds, delay: s.trafficDelayInSeconds ?? 0, coords, spans };
  });
}

// Cameras within maxM metres of the route line, ordered by distance from the start.
// Flat-earth maths is fine at this scale (errors far below the camera position error).
export function camerasAlong(coords, cameras, maxM = 60) {
  const kx = 111320 * Math.cos((-6.2 * Math.PI) / 180), ky = 110540;
  const xy = coords.map(([lng, lat]) => [lng * kx, lat * ky]);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs) - maxM, Math.max(...xs) + maxM, Math.min(...ys) - maxM, Math.max(...ys) + maxM];
  const out = [];
  for (const c of cameras) {
    if (c.lat == null) continue;
    const px = c.lng * kx, py = c.lat * ky;
    if (px < x0 || px > x1 || py < y0 || py > y1) continue;
    let best = Infinity, at = 0;
    for (let i = 1; i < xy.length; i++) {
      const [ax, ay] = xy[i - 1], dx = xy[i][0] - ax, dy = xy[i][1] - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
      const d = Math.hypot(px - ax - t * dx, py - ay - t * dy);
      if (d < best) { best = d; at = cum[i - 1] + t * Math.sqrt(len2); }
    }
    if (best <= maxM) out.push({ id: c.id, at: Math.round(at) });
  }
  return out.sort((a, b) => a.at - b.at);
}

async function tomtom(kind, url, now) {
  const hit = memo.get(url);
  if (hit && now - hit.at < TTL[kind]) return hit.data;
  const day = new Date(now + 7 * 3600_000).toISOString().slice(0, 10); // WIB date
  if (used.day !== day) Object.assign(used, { day, route: 0, search: 0 });
  if (used[kind] >= DAILY[kind]) throw Object.assign(new Error('quota'), { status: 429 });
  used[kind]++;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw Object.assign(new Error(`tomtom ${res.status}`), { status: res.status === 429 ? 429 : 502 });
  const data = await res.json();
  if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value);
  memo.set(url, { at: now, data });
  return data;
}

const ERR = { 400: 'Titik asal atau tujuan tidak valid', 429: 'Kuota rute hari ini sudah habis, coba lagi besok', 502: 'Layanan rute sedang gangguan', 503: 'Fitur rute belum aktif' };
const fail = (status) => ({ status, body: { error: ERR[status] } });

// path /api/route?from=lat,lng&to=lat,lng&mode=motor|mobil  or  /api/search?q=...
export async function handle(path, params, cameras, key = process.env.TOMTOM_API_KEY, now = Date.now()) {
  if (!key) return fail(503);
  try {
    if (path === '/api/route') {
      const a = point(params.get('from')), b = point(params.get('to'));
      if (!inArea(a) || !inArea(b)) return fail(400);
      const motor = params.get('mode') !== 'mobil';
      // Motorcycles may not use toll roads in Indonesia.
      const url = `https://api.tomtom.com/routing/1/calculateRoute/${a.lat.toFixed(5)},${a.lng.toFixed(5)}:${b.lat.toFixed(5)},${b.lng.toFixed(5)}/json`
        + `?key=${encodeURIComponent(key)}&traffic=true&maxAlternatives=2&sectionType=traffic&routeRepresentation=polyline`
        + `&travelMode=${motor ? 'motorcycle' : 'car'}${motor ? '&avoid=tollRoads' : ''}`;
      const routes = parseRoutes(await tomtom('route', url, now));
      for (const r of routes) r.cameras = camerasAlong(r.coords, cameras);
      return { status: 200, body: { routes } };
    }
    if (path === '/api/search') {
      const q = (params.get('q') ?? '').trim().slice(0, 100);
      if (q.length < 3) return { status: 200, body: { results: [] } };
      const url = `https://api.tomtom.com/search/2/search/${encodeURIComponent(q.toLowerCase())}.json`
        + `?key=${encodeURIComponent(key)}&countrySet=ID&limit=6&lat=-6.22&lon=106.83&radius=90000&language=id-ID`;
      const data = await tomtom('search', url, now);
      const results = (data.results ?? []).map((r) => ({
        name: r.poi?.name ?? r.address?.streetName ?? r.address?.freeformAddress,
        address: r.address?.freeformAddress ?? '',
        lat: r.position.lat, lng: r.position.lon,
      }));
      return { status: 200, body: { results } };
    }
  } catch (e) {
    if (e.status !== 429) console.error('route api:', e.message);
    return fail(e.status === 429 ? 429 : 502);
  }
  return undefined;
}
