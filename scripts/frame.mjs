// Grab frames from a camera. Frames stay in memory only; nothing is written to disk.
// grabFrames() returns two JPEGs ~2 s apart from the stream (so motion can be measured),
// or a single snapshot when the stream won't give two, or [] when the camera is down.
import { spawn } from 'node:child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
export const PAIR_SECONDS = 2;

export const isJpeg = (buf) => buf?.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;

// Split concatenated JPEGs (ffmpeg image2pipe output) at EOI+SOI boundaries.
export function splitJpegs(buf) {
  const parts = [];
  let start = 0;
  for (let i = 2; i < buf.length - 1; i++) {
    if (buf[i] === 0xff && buf[i + 1] === 0xd8 && buf[i - 2] === 0xff && buf[i - 1] === 0xd9) {
      parts.push(buf.subarray(start, i));
      start = i;
    }
  }
  parts.push(buf.subarray(start));
  return parts.filter(isJpeg);
}

function ffmpegFrames(url, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', '-user_agent', UA, '-i', url,
      '-vf', `fps=1/${PAIR_SECONDS}`, '-frames:v', '2', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-']);
    const chunks = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => resolve([])); // ffmpeg missing
    p.on('close', () => { clearTimeout(timer); resolve(splitJpegs(Buffer.concat(chunks))); });
  });
}

export async function grabFrames(cam, timeoutMs = 25000) {
  const frames = await ffmpegFrames(cam.stream, timeoutMs).catch(() => []);
  if (frames.length || !cam.snapshot) return frames;
  try {
    const res = await fetch(cam.snapshot, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    return isJpeg(buf) ? [buf] : [];
  } catch {
    return [];
  }
}

// Width/height from the JPEG's SOF header, without decoding.
export function jpegSize(buf) {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const m = buf[i + 1];
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

// Run fn over items with at most n in flight.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
