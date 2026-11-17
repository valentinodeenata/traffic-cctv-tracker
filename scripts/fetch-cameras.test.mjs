// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDki, parseBpjt, parseBinaMarga, inJabodetabek, applyDkiLocations } from './fetch-cameras.mjs';

test('applyDkiLocations: matches by location name, spreads cameras sharing a point', () => {
  const cams = [{ name: 'JL. X CCTV-01' }, { name: 'JL. X CCTV-02' }, { name: 'Senayan 018' }, { name: 'Unknown CCTV-01', lat: null }];
  applyDkiLocations(cams, { 'JL. X': [-6.2, 106.8, 'q'], 'Senayan 018': [-6.22, 106.8, 'q'] });
  assert.ok(cams[0].approx && cams[1].approx);
  assert.notDeepEqual([cams[0].lat, cams[0].lng], [cams[1].lat, cams[1].lng]);
  assert.ok(Math.abs(cams[0].lat - -6.2) < 0.001 && Math.abs(cams[1].lng - 106.8) < 0.001);
  assert.deepEqual([cams[2].lat, cams[2].lng], [-6.22, 106.8]); // alone: exact point
  assert.equal(cams[3].lat, null);
});

test('parseDki: Bali Tower camera gets a snapshot, jakcctv-hosted one does not', () => {
  const html = `<iframe src="https://dki-jkt.balitower.co.id:7028/502045_JKP_X_CCTV-01/embed.html" loading="lazy"></iframe>
    <div class="title">JKP POLDA JPO JL. GATOT SUBROTO 7</div>\n<span class="badge">CCTV-01</span>
    <iframe src="https://jakcctv.jakarta.go.id/Senayan-018-705979_2/embed.html?proto=hls" loading="lazy"></iframe>
    <div class="title">Senayan 018</div>\n<span class="badge">CCTV-2</span>`;
  const [a, b] = parseDki(html);
  assert.equal(a.name, 'JKP POLDA JPO JL. GATOT SUBROTO 7 CCTV-01');
  assert.equal(a.snapshot, 'https://dki-jkt.balitower.co.id:7028/502045_JKP_X_CCTV-01/preview.jpg');
  assert.equal(b.stream, 'https://jakcctv.jakarta.go.id/Senayan-018-705979_2/index.m3u8');
  assert.equal(b.snapshot, null);
});

test('parseBpjt: keeps Jabodetabek, dedupes, trims URLs', () => {
  const cam = (uid, lat, url, bujt = 'jm', lon = '106.85') => `{"id":"1","tgl_tarik":"x","unique_id":"${uid}","nama_ruas":"Dalam Kota","nama_km":"KM 1","nama_segment":"","bujt":"${bujt}","lat":"${lat}","lon":"${lon}","stream":"","streamhls":"${url}"}`;
  const html = [
    cam('a', '-6.2', ' https://x/a.m3u8'), cam('a', '-6.2', 'https://x/a.m3u8'), // duplicate row
    cam('a', '-6.21', 'https://x/hk.m3u8', 'hk'),     // same unique_id, other operator = other camera
    cam('d', '-6,108464', 'https://x/d.m3u8', 'hk'),  // decimal comma
    cam('e', '106.9', 'https://x/e.m3u8', 'hk', '-6.1'), // lat/lon swapped
    cam('b', '-7.8', 'https://x/b.m3u8'), cam('c', '0.0', 'https://x/c.m3u8'), // outside the box
  ].join(',');
  const out = parseBpjt(html);
  assert.deepEqual(out.map((c) => c.id), ['bpjt:jm-a', 'bpjt:hk-a', 'bpjt:hk-d', 'bpjt:hk-e']);
  assert.equal(out[0].stream, 'https://x/a.m3u8');
  assert.equal(out[0].name, 'Dalam Kota · KM 1');
  assert.equal(out[3].lat, -6.1);
});

test('parseBinaMarga: only "its" cameras inside the box', () => {
  const js = `{ lat: -6.26267497, lng: 107.06284490, info: "Tambun Selatan<br />Bekasi", category: "its", url: "https://binamarga.pu.go.id/play-hls/33/its" },
    { lat: -7.7, lng: 109.9, info: "Purworejo", category: "its", url: "https://binamarga.pu.go.id/play-hls/99/its" },
    { lat: -6.2, lng: 106.9, info: "X", category: "apace", url: "https://apace-ai.com/APC1/" }`;
  const out = parseBinaMarga(js);
  assert.deepEqual(out.map((c) => c.name), ['Tambun Selatan · Bekasi']);
  assert.ok(!inJabodetabek(0, 0));
});
