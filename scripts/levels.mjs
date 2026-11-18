// Traffic level per camera: lancar / ramai / padat / offline.
//
// A raw vehicle count says little: a wide road always shows a handful of cars, and a traffic light
// always has a queue. So the level compares against this camera's own normal at this time of day,
// and "padat" needs vehicles that are standing still (two frames 2 s apart), for more than one pass.
//
//   padat  stopped >= max(4, 2 x usual stopped + 1) and at least half of what's visible is stopped,
//          in >= 2 of the last 3 passes (~10 min; a red light lasts one pass at most),
//          or all 3 while the camera's usual stopped count is still unknown
//   ramai  visible >= max(8, 1.5 x usual + 2) (only once a usual exists), or the padat condition in the latest pass only
//   lancar otherwise
//
// "usual" = median for this camera within +-1 h of the current time of day over the last 7 days,
// skipping the last 30 min so an ongoing jam doesn't become its own baseline.
// Parked vehicles are "stopped" in every pass, so they raise the usual and stop counting against it.
import { RETENTION } from './db.mjs';

export const RULES = { WINDOW: 3, NEED: 2, MIN_STOPPED: 4, STOPPED_SHARE: 0.5, MIN_BUSY: 8, MIN_SAMPLES: 6 };
const LIVE_SECONDS = 15 * 60;
const TZ_HOURS = 7; // WIB

const jammed = (r, usualStopped) =>
  r.stopped != null && r.stopped >= Math.max(RULES.MIN_STOPPED, 2 * usualStopped + 1) && r.stopped >= RULES.STOPPED_SHARE * r.vehicles;

// recent: newest first, [{ vehicles, stopped }]; usual: { vehicles, stopped } medians or null
export function levelFor(recent, usual) {
  const now = recent[0];
  if (!now || now.vehicles == null) return 'offline';
  const uv = usual?.vehicles ?? 0, us = usual?.stopped ?? 0;
  // Until this camera's usual queue is known, a red light could hit two passes in a row: require all three.
  const need = usual?.stopped == null ? RULES.WINDOW : RULES.NEED;
  if (recent.slice(0, RULES.WINDOW).filter((r) => jammed(r, us)).length >= need) return 'padat';
  // "More cars than usual" needs a usual; without one, only standing traffic can make it ramai.
  if ((usual && now.vehicles >= Math.max(RULES.MIN_BUSY, 1.5 * uv + 2)) || jammed(now, us)) return 'ramai';
  return 'lancar';
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const hourOfDay = (ts) => (Math.floor(ts / 3600) + TZ_HOURS) % 24;

// Counts from different detection models aren't comparable (yolox_s sees ~60% more than nano),
// so the baseline only uses readings taken since the current model started.
export function markModel(db, model, now) {
  const cur = db.prepare("SELECT value FROM meta WHERE key = 'model'").get()?.value;
  if (cur === model) return;
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('model', ?)").run(model);
  db.prepare("INSERT OR REPLACE INTO meta VALUES ('model_since', ?)").run(String(now));
}

// Medians per camera around the current hour of day.
export function usualByCamera(db, now) {
  const h = hourOfDay(now);
  const hours = new Set([(h + 23) % 24, h, (h + 1) % 24]);
  const since = +(db.prepare("SELECT value FROM meta WHERE key = 'model_since'").get()?.value ?? 0);
  const rows = db.prepare('SELECT camera_id, ts, vehicles, stopped FROM readings WHERE ts >= ? AND ts < ? AND vehicles IS NOT NULL')
    .all(Math.max(since, now - RETENTION.RAW_DAYS * 86400), now - 30 * 60);
  const by = new Map();
  for (const r of rows) {
    if (!hours.has(hourOfDay(r.ts))) continue;
    const g = by.get(r.camera_id) ?? { v: [], s: [] };
    g.v.push(r.vehicles);
    if (r.stopped != null) g.s.push(r.stopped);
    by.set(r.camera_id, g);
  }
  const out = new Map();
  for (const [id, g] of by) {
    if (g.v.length < RULES.MIN_SAMPLES) continue;
    out.set(id, { vehicles: median(g.v), stopped: g.s.length >= RULES.MIN_SAMPLES ? median(g.s) : null, samples: g.v.length });
  }
  return out;
}

// Level for every camera that has reported; cameras missing from the map are offline.
export function computeLevels(db, now) {
  const usual = usualByCamera(db, now);
  const rows = db.prepare(`SELECT r.camera_id, r.ts, r.vehicles, r.stopped FROM readings r
      JOIN camera_status s ON s.camera_id = r.camera_id
      WHERE r.ts >= ? AND s.last_ok >= ? ORDER BY r.ts DESC`)
    .all(now - (RULES.WINDOW * 5 + 2) * 60, now - LIVE_SECONDS);
  const recent = new Map();
  for (const r of rows) recent.set(r.camera_id, [...(recent.get(r.camera_id) ?? []), r]);
  const out = new Map();
  for (const [id, rs] of recent) {
    const u = usual.get(id) ?? null;
    out.set(id, { level: levelFor(rs, u), vehicles: rs[0].vehicles, stopped: rs[0].stopped, usual: u });
  }
  return out;
}
