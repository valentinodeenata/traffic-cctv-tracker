// Run: node --test "scripts/*.test.mjs"
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCards } from './fetch-cameras-dki.mjs';

test('parseCards reads the portal card markup', () => {
  const html = `\t<div class="card">\n\t\t<div class="card-body">\n\t\t\t<iframe src="https://dki-jkt.balitower.co.id:7028/502045_JKP_X_CCTV-01/embed.html" loading="lazy"></iframe>\n\t\t</div>\n\t\t<div class="card-footer">\n\t\t\t<div class="title">JKP POLDA JPO JL. GATOT SUBROTO 7</div>\n\t\t\t<span class="badge">CCTV-01</span>\n`;
  const [c] = parseCards(html);
  assert.equal(c.id, '502045_JKP_X_CCTV-01');
  assert.equal(c.name, 'JKP POLDA JPO JL. GATOT SUBROTO 7');
  assert.equal(c.cam, 'CCTV-01');
  assert.equal(c.snapshot, 'https://dki-jkt.balitower.co.id:7028/502045_JKP_X_CCTV-01/preview.jpg');
  assert.equal(parseCards('<div>nothing</div>').length, 0);
  // some cameras live on jakcctv itself and carry a query string
  const [s] = parseCards(`<iframe src="https://jakcctv.jakarta.go.id/Senayan-018-705979_2/embed.html?proto=hls" loading="lazy"></iframe>\n<div class="title">Senayan 018</div>\n<span class="badge">CCTV-2</span>`);
  assert.equal(s.hls, 'https://jakcctv.jakarta.go.id/Senayan-018-705979_2/index.m3u8');
  assert.equal(s.snapshot, null); // no preview.jpg there
});
