// Grab one JPEG frame from a camera: direct snapshot when available, else ffmpeg on the stream.
// Frames stay in memory only; nothing is written to disk.
import { spawn } from 'node:child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';

export const isJpeg = (buf) => buf?.length > 3 && buf[0] === 0xff && buf[1] === 0xd8;

function ffmpegFrame(url, timeoutMs) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-loglevel', 'error', '-user_agent', UA, '-i', url,
      '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-']);
    const chunks = [];
    const timer = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', () => resolve(null)); // ffmpeg missing
    p.on('close', () => { clearTimeout(timer); resolve(Buffer.concat(chunks)); });
  });
}

export async function grabFrame(cam, timeoutMs = 20000) {
  let buf = null;
  try {
    if (cam.snapshot) {
      const res = await fetch(cam.snapshot, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    }
    if (!isJpeg(buf)) buf = await ffmpegFrame(cam.stream, timeoutMs);
  } catch {
    buf = null;
  }
  return isJpeg(buf) ? buf : null;
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
