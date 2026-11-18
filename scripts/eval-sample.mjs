// Accuracy check: grab a frame pair from a stratified sample of live cameras, run each model on the
// same frames, and write annotated copies for manual review (green = moving, orange = stopped).
// Output (gitignored): snapshots/eval-<ts>/<n>.jpg (raw), <n>_<model>.jpg (annotated), results.json
// Run: node scripts/eval-sample.mjs [count=50] [models=yolox_nano,yolox_s]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { grabFrames, pool, jpegSize } from './frame.mjs';
import { detector, motion, INPUT_SIZE } from './detect.mjs';

const N = +(process.argv[2] ?? 50);
const models = (process.argv[3] ?? 'yolox_nano,yolox_s').split(',');
const detectors = Object.fromEntries(models.map((m) => [m, detector(m)]));
const cams = JSON.parse(readFileSync('data/cameras.json', 'utf8'));

// Live cameras only, then sample each source in proportion to its live count.
const live = (await pool(cams, 16, async (c) => ({ c, frames: await grabFrames(c, 12000) }))).filter((x) => x.frames.length);
const bySource = Map.groupBy(live, (x) => x.c.source);
const picked = [];
for (const [, group] of bySource) {
  const k = Math.max(1, Math.round((group.length / live.length) * N));
  for (let i = 0; i < k && i < group.length; i++) picked.push(group[Math.floor((i * group.length) / k)]);
}

const dir = `snapshots/eval-${Math.floor(Date.now() / 1000)}`;
mkdirSync(dir, { recursive: true });
const results = [];
for (const [n, { c, frames }] of picked.slice(0, N).entries()) {
  writeFileSync(`${dir}/${n}.jpg`, frames[0]);
  const { w, h } = jpegSize(frames[0]);
  const row = { n, id: c.id, name: c.name, source: c.source, w, h };
  for (const m of models) {
    const t = Date.now();
    let boxes = await detectors[m](frames[0]);
    if (frames[1]) boxes = motion(boxes, await detectors[m](frames[1]));
    row[m] = { detected: boxes.length, stopped: boxes.filter((b) => b.stopped).length, ms: Date.now() - t };
    const r = Math.min(INPUT_SIZE[m] / w, INPUT_SIZE[m] / h);
    const draw = boxes.map((b) => {
      const [x, y, bw, bh] = [b.x1 / r, b.y1 / r, (b.x2 - b.x1) / r, (b.y2 - b.y1) / r].map((v) => Math.max(0, Math.round(v)));
      return `drawbox=x=${x}:y=${y}:w=${bw}:h=${bh}:color=${b.stopped ? 'orange' : 'lime'}@0.9:t=2`;
    }).join(',') || 'null';
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-vf', draw, `${dir}/${n}_${m}.jpg`], { input: frames[0] });
  }
  results.push(row);
}
writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 2));
const sum = (m, k) => results.reduce((a, r) => a + r[m][k], 0);
console.log(`${results.length} frames in ${dir} (from ${live.length} live cameras)`);
for (const m of models) console.log(`  ${m}: ${sum(m, 'detected')} vehicles, ${Math.round(sum(m, 'ms') / results.length)} ms per camera (2 frames)`);
