// Count vehicles in a JPEG frame with YOLOX-nano (Apache-2.0, COCO classes).
// Model: models/yolox_nano.onnx from github.com/Megvii-BaseDetection/YOLOX/releases (0.1.1rc0)
import { spawn } from 'node:child_process';
import ort from 'onnxruntime-node';

const SIZE = 416;
const STRIDES = [8, 16, 32];
// COCO "train" (6) is what the model calls a TransJakarta articulated bus seen from behind.
export const VEHICLE_CLASSES = { 2: 'car', 3: 'motorcycle', 5: 'bus', 6: 'bus', 7: 'truck' };
const SCORE_MIN = 0.3; // ponytail: fixed threshold; tune per camera if night/rain accuracy turns out poor
const IOU_MAX = 0.45;

let session;
const getSession = async () => (session ??= await ort.InferenceSession.create(new URL('../models/yolox_nano.onnx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')));

// YOLOX >= 0.1.1 preprocessing (the 0.1.1rc0 release models use it):
// letterbox top-left with pad 114, BGR, raw 0..255, no mean/std.
function toBgr(jpeg) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', '-i', 'pipe:0', '-vf',
      `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:0:0:color=0x727272`,
      '-pix_fmt', 'bgr24', '-f', 'rawvideo', 'pipe:1']);
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', reject);
    p.on('close', () => {
      const buf = Buffer.concat(chunks);
      buf.length === SIZE * SIZE * 3 ? resolve(buf) : reject(new Error(`ffmpeg gave ${buf.length} bytes`));
    });
    p.stdin.on('error', () => {}); // ffmpeg may close stdin early on bad input
    p.stdin.end(jpeg);
  });
}

// HWC uint8 -> CHW float32
function toTensor(bgr) {
  const n = SIZE * SIZE, data = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) data[c * n + i] = bgr[i * 3 + c];
  return new ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
}

// Raw YOLOX output [N, 85] (grid-relative boxes, sigmoid scores) -> vehicle boxes after NMS.
export function decode(out, rows) {
  const boxes = [];
  let r = 0;
  for (const s of STRIDES) {
    const g = SIZE / s;
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

export async function detectVehicles(jpeg) {
  const s = await getSession();
  const res = await s.run({ images: toTensor(await toBgr(jpeg)) });
  return decode(res.output.data, res.output.dims[1]);
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
