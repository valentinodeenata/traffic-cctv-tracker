// Builds data/cameras.json from public CCTV portals around Jakarta.
// Run: node scripts/fetch-cameras.mjs
//
// Every camera: { id, name, source, lat, lng, stream, snapshot }
//   stream   = URL ffmpeg can read (HLS or MJPEG)
//   snapshot = direct JPEG URL when the server offers one (cheaper than ffmpeg), else null
import { writeFileSync, mkdirSync } from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (url, as = 'text') => {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res[as]();
};

// Jabodetabek bounding box
export const inJabodetabek = (lat, lng) => lat < -6.05 && lat > -6.45 && lng > 106.55 && lng < 107.15;

// --- Pemprov DKI (jakcctv.jakarta.go.id/publik): paged JSON with card HTML, no coordinates ---
export function parseDki(html) {
  const re = /<iframe src="([^"]+)\/embed\.html[^"]*"[\s\S]*?<div class="title">([^<]+)<\/div>\s*<span class="badge">([^<]*)<\/span>/g;
  return [...html.matchAll(re)].map(([, base, title, badge]) => ({
    id: 'dki:' + base.split('/').pop(),
    name: `${title.trim()} ${badge.trim()}`,
    source: 'Pemprov DKI Jakarta',
    lat: null, // ponytail: portal has no coordinates; geocode the 26 locations later
    lng: null,
    stream: `${base}/index.m3u8`,
    // only Bali Tower's Flussonic serves preview.jpg
    snapshot: base.includes('balitower.co.id') ? `${base}/preview.jpg` : null,
  }));
}

async function fetchDki() {
  const out = [];
  for (let page = 1; ; page++) {
    const data = JSON.parse(await get(`https://jakcctv.jakarta.go.id/publik/data?q=&page=${page}`));
    const cams = parseDki(data.cards);
    out.push(...cams);
    if (!cams.length || out.length >= data.total) return out;
    await sleep(1000);
  }
}

// --- BPJT Kementerian PU (bpjt.pu.go.id/cctv): toll cameras embedded as JSON in the page ---
export function parseBpjt(html) {
  const byId = new Map();
  for (const [json] of html.matchAll(/\{"id":"\d+","tgl_tarik"[^{}]*\}/g)) {
    const o = JSON.parse(json);
    // the data is hand-entered: decimal commas and swapped lat/lon both occur
    let [lat, lng] = [o.lat, o.lon].map((v) => +String(v).replace(',', '.'));
    if (Math.abs(lat) > 90) [lat, lng] = [lng, lat];
    const url = (o.streamhls || o.stream || '').trim();
    if (!inJabodetabek(lat, lng) || !url) continue;
    const id = `${o.bujt}-${o.unique_id}`; // unique_id alone collides across operators
    byId.set(id, {
      id: 'bpjt:' + id,
      name: [o.nama_ruas, o.nama_km || o.nama_segment].filter(Boolean).join(' · '),
      source: `BPJT Kementerian PU (${o.bujt})`,
      lat, lng,
      stream: url,
      snapshot: null,
    });
  }
  return [...byId.values()];
}

// --- Bina Marga (binamarga.pu.go.id/cctv-ai): national roads; m3u8 sits in each player page ---
export function parseBinaMarga(html) {
  const re = /lat:\s*(-?[\d.]+),\s*lng:\s*(-?[\d.]+),\s*info:\s*"([^"]*)",\s*category:\s*"its",\s*url:\s*"([^"]+\/play-hls\/[^"]+)"/g;
  return [...html.matchAll(re)]
    .map(([, lat, lng, info, player]) => ({ lat: +lat, lng: +lng, name: info.replace(/<br\s*\/?>/g, ' · '), player }))
    .filter((c) => inJabodetabek(c.lat, c.lng));
  // ponytail: "apace" category cameras use a separate viewer, skipped
}

async function fetchBinaMarga() {
  const out = [];
  for (const c of parseBinaMarga(await get('https://binamarga.pu.go.id/cctv-ai'))) {
    const m = (await get(c.player)).match(/source src="([^"]+\.m3u8)"/);
    if (m) out.push({ id: 'bm:' + c.player.split('/play-hls/')[1], name: c.name, source: 'Bina Marga Kementerian PU', lat: c.lat, lng: c.lng, stream: m[1], snapshot: null });
    await sleep(1000);
  }
  return out;
}

async function main() {
  const sources = { dki: fetchDki, bpjt: async () => parseBpjt(await get('https://bpjt.pu.go.id/cctv/')), binamarga: fetchBinaMarga };
  const cameras = [];
  for (const [name, fn] of Object.entries(sources)) {
    try {
      const cams = await fn();
      console.log(`${name}: ${cams.length}`);
      cameras.push(...cams);
    } catch (e) {
      console.error(`${name}: FAILED ${e.message}`); // one dead portal shouldn't kill the rest
    }
  }
  mkdirSync('data', { recursive: true });
  writeFileSync('data/cameras.json', JSON.stringify(cameras, null, 2) + '\n');
  console.log(`${cameras.length} cameras -> data/cameras.json`);
}

if (import.meta.main) main();
