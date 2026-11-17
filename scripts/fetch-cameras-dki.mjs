// Builds data/cameras-dki.json from the official DKI public CCTV page (jakcctv.jakarta.go.id/publik).
// Streams are Flussonic on Bali Tower: <base>/index.m3u8 (HLS) and <base>/preview.jpg (snapshot).
// Run: node scripts/fetch-cameras-dki.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const LIST = 'https://jakcctv.jakarta.go.id/publik/data';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseCards(html) {
  const re = /<iframe src="([^"]+)\/embed\.html[^"]*"[\s\S]*?<div class="title">([^<]+)<\/div>\s*<span class="badge">([^<]*)<\/span>/g;
  return [...html.matchAll(re)].map(([, base, title, badge]) => ({
    id: base.split('/').pop(),
    name: title.trim(),
    cam: badge.trim(),
    city: 'Jakarta',
    source: 'Pemprov DKI Jakarta (jakcctv.jakarta.go.id)',
    hls: `${base}/index.m3u8`,
    // only Bali Tower's Flussonic serves preview.jpg; null = grab a frame from hls with ffmpeg
    snapshot: base.includes('balitower.co.id') ? `${base}/preview.jpg` : null,
    lat: null, // ponytail: the portal has no coordinates; filled in by hand/geocoding later
    lng: null,
  }));
}

async function main() {
  const cameras = [];
  for (let page = 1; ; page++) {
    const res = await fetch(`${LIST}?q=&page=${page}`);
    if (!res.ok) throw new Error(`page ${page}: HTTP ${res.status}`);
    const data = await res.json();
    const cards = parseCards(data.cards);
    if (!cards.length) break;
    cameras.push(...cards);
    if (cameras.length >= data.total) break;
    await sleep(1000); // be gentle with a government server
  }
  mkdirSync('data', { recursive: true });
  writeFileSync('data/cameras-dki.json', JSON.stringify(cameras, null, 2) + '\n');
  console.log(`${cameras.length} cameras -> data/cameras-dki.json`);
}

if (import.meta.main) main();
