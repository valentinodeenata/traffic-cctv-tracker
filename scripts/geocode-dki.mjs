// One-off: approximate coordinates for the DKI portal's camera locations (it publishes names only).
// Writes data/dki-locations.json { "<location name>": [lat, lng, "<query used>"] }; fetch-cameras.mjs applies it.
// Coordinates are street/area level, not the exact pole: the UI labels them as approximate.
// Run: node scripts/geocode-dki.mjs   (Nominatim, 1 request/second per its usage policy)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = 'data/dki-locations.json';
// Places a street-name search can't find
const OVERRIDES = {
  'JKP POLRI UOB PLAZA C01': 'UOB Plaza, Jalan M.H. Thamrin',
  'JKP DBM FLYOVER LADOKGI C01': 'Jalan Gatot Subroto, Semanggi',
  'Taman Literasi-C01': 'Taman Literasi Martha Christina Tiahahu',
  'Pasar Tanah Abang-C02': 'Pasar Tanah Abang',
};

export const locationOf = (name) => name.replace(/\s+CCTV-?\d+$/, '');

export function toQuery(loc) {
  if (OVERRIDES[loc]) return OVERRIDES[loc];
  return loc
    .replace(/^JK[PBTSU]\s+/, '')
    .replace(/^(POLDA|POLRI|DISHUB|DBM|SATPOL\s?-?PP|SATPOLPP)\s+/, '')
    .replace(/^(SIMPANG|JPO)\s+/i, '')
    .replace(/[-\s]+C\d+$/i, '')
    .replace(/\s+\d+$/, '')
    .replace(/\bJL\.?\s*/i, 'Jalan ')
    .replace(/\bJEND\.\s*/i, 'Jenderal ')
    .replace(/\bLETJEN\.\s*/i, 'Letjen ')
    .replace(/\bMH\.\s*/i, 'M.H. ')
    .replace(/\bKH\.\s*/i, 'K.H. ')
    .replace(/\bS\.\s*PARMAN/i, 'S. Parman')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

async function main() {
  const cams = JSON.parse(readFileSync('data/cameras.json', 'utf8')).filter((c) => c.id.startsWith('dki:'));
  const out = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
  for (const loc of new Set(cams.map((c) => locationOf(c.name)))) {
    if (out[loc]) continue;
    const q = toQuery(loc);
    const url = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
      q: `${q}, Jakarta`, format: 'json', limit: '1', countrycodes: 'id',
      viewbox: '106.68,-6.08,106.98,-6.37', bounded: '1',
    });
    const res = await fetch(url, { headers: { 'User-Agent': 'traffic-cctv-tracker/1.0 (github.com/valentinodeenata/traffic-cctv-tracker)' } });
    const [hit] = res.ok ? await res.json() : [];
    console.log(`${hit ? 'ok  ' : 'MISS'} ${loc}  ->  ${q}${hit ? `  (${hit.display_name.split(',').slice(0, 3).join(',')})` : ''}`);
    if (hit) out[loc] = [+(+hit.lat).toFixed(6), +(+hit.lon).toFixed(6), q];
    await new Promise((r) => setTimeout(r, 1100));
  }
  writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
}

if (import.meta.main) main();
