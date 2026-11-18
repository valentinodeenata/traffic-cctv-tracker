// Count vehicles in a JPEG frame with YOLOX (Apache-2.0, COCO classes).
// Models: models/<name>.onnx from github.com/Megvii-BaseDetection/YOLOX/releases (0.1.1rc0).
// DETECT_MODEL picks one (default yolox_nano); each has a fixed square input size.
import { spawn } from 'node:child_process';
import ort from 'onnxruntime-node';

export const INPUT_SIZE = { yolox_nano: 416, yolox_tiny: 416, yolox_s: 640 };
// yolox_s: 2026-11-18 check on 50 daytime frames found ~60% more vehicles than nano at similar precision
// (nano shrinks 1080p toll cameras to 416 px and loses everything past the first few cars).
export const MODEL = process.env.DETECT_MODEL || 'yolox_s';
const STRIDES = [8, 16, 32];
// COCO "train" (6) is left out on purpose: both models call a TransJakarta bus seen from behind a train,
// but real KRL trains pass several cameras, and a spike from a train is worse than one uncounted bus.
export const VEHICLE_CLASSES = { 2: 'car', 3: 'motorcycle', 5: 'bus', 7: 'truck' };
const SCORE_MIN = 0.3; // ponytail: fixed threshold; tune per camera if night/rain accuracy turns out poor
const IOU_MAX = 0.45;

// YOLOX >= 0.1.1 preprocessing (the 0.1.1rc0 release models use it):
// letterbox top-left with pad 114, BGR, raw 0..255, no mean/std.
function toBgr(jpeg, size) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-vf',
      `scale=${size}:${size}:force_original_aspect_ratio=decrease,pad=${size}:${size}:0:0:color=0x727272`,
      '-pix_fmt', 'bgr24', '-f', 'rawvideo', 'pipe:1']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', reject);
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      buf.length === size * size * 3 ? resolve(buf) : reject(new Error(`ffmpeg gave ${buf.length} bytes`));
    });
    p.stdin.on('error', () => {}); // ffmpeg may close stdin early on bad input
    p.stdin.end(jpeg);
  });
}

// HWC uint8 -> CHW float32
function toTensor(bgr, size) {
  const n = size * size, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = bgr[i * 3 + c];
  return new ort.Tensor('float32', data, [1, 3, size, size]);
}

// Raw YOLOX output [N, 85] (grid-relative boxes, sigmoid scores) -> vehicle boxes after NMS.
export function decode(out, rows, size = INPUT_SIZE.yolox_nano) {
  const boxes = [];
  let r = 0;
  for (const s of STRIDES) {
    const g = size / s;
    for (let y = 0; y < g; y++) for (let x = 0; x < g; x++, r++) {
      if (r >= rows) break;
      const o = r * 85, obj = out[o + 4];
      if (obj < SCORE_MIN) continue;
      let best = -1, bestScore = 0;
      for (const k in VEHICLE_CLASSES) { const sc = obj * out[o + 5 + +k]; if (sc > bestScore) { bestScore = sc; best = +k; } }
      if (bestScore < SCORE_MIN) continue;
      const cx = (out[o] + x) * s, cy = (out[o + 1] + y) * s;
      const w = Math.exp(out[o + 2]) * s, h = Math.exp(out[o + 3]) * s;
      boxes.push({ x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2, score: bestScore, cls: VEHICLE_CLASSES[best] });
    }
  }
  return nms(boxes);
}

const iou = (a, b) => {
  const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = w * h;
  return inter / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter);
};

// Class-agnostic: a car and a "truck" on the same spot are one vehicle.
export function nms(boxes) {
  const keep = [];
  for (const b of boxes.sort((p, q) => q.score - p.score)) if (keep.every((k) => iou(k, b) < IOU_MAX)) keep.push(b);
  return keep;
}

// detector('yolox_s') -> async (jpeg) => boxes in that model's letterboxed input coordinates
export function detector(name = MODEL) {
  const size = INPUT_SIZE[name];
  if (!size) throw new Error(`unknown model ${name}`);
  const path = new URL(`../models/${name}.onnx`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
  let session;
  return async (jpeg) => {
    session ??= await ort.InferenceSession.create(path);
    const res = await session.run({ images: toTensor(await toBgr(jpeg, size), size) });
    return decode(res.output.data, res.output.dims[1], size);
  };
}
export const detectVehicles = detector();

// Which vehicles in frame A are still in place in frame B (~2 s later)?
// Matched greedily by overlap; "stopped" = centre moved less than STILL x its own width.
// A vehicle with no match counts as moving (left the spot, or flickered): errs toward "not jammed".
const STILL = 0.25;
export function motion(a, b) {
  const pairs = [];
  a.forEach((x, i) => b.forEach((y, j) => { const v = iou(x, y); if (v > 0.1) pairs.push([v, i, j]); }));
  pairs.sort((p, q) => q[0] - p[0]);
  const usedA = new Set(), usedB = new Set(), stopped = new Set();
  for (const [, i, j] of pairs) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i); usedB.add(j);
    const x = a[i], y = b[j];
    const d = Math.hypot((x.x1 + x.x2 - y.x1 - y.x2) / 2, (x.y1 + x.y2 - y.y1 - y.y2) / 2);
    if (d < STILL * (x.x2 - x.x1)) stopped.add(i);
  }
  return a.map((x, i) => ({ ...x, stopped: stopped.has(i) }));
}

// Letterboxed model-input boxes -> fractions of the original image (0..1), for drawing over the frame.
export function normalizeBoxes(boxes, w, h, size = INPUT_SIZE[MODEL]) {
  const r = Math.min(size / w, size / h);
  const fx = (v) => +Math.min(1, Math.max(0, v / (w * r))).toFixed(4);
  const fy = (v) => +Math.min(1, Math.max(0, v / (h * r))).toFixed(4);
  return boxes.map((b) => ({ x1: fx(b.x1), y1: fy(b.y1), x2: fx(b.x2), y2: fy(b.y2), cls: b.cls, score: +b.score.toFixed(2), stopped: !!b.stopped }));
}

// CLI: node scripts/detect.mjs frame.jpg [...]
if (import.meta.main) {
  const { readFileSync } = await import('node:fs');
  for (const f of process.argv.slice(2)) {
    const boxes = await detectVehicles(readFileSync(f));
    const by = boxes.reduce((a, b) => ((a[b.cls] = (a[b.cls] || 0) + 1), a), {});
    console.log(`${f}: ${boxes.length} vehicles ${JSON.stringify(by)}`);
  }
}
