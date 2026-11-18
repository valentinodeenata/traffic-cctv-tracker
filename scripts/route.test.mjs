import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutes, camerasAlong, handle, DAILY } from './route.mjs';

// Shape of a TomTom calculateRoute answer, trimmed to what we read
const tomtomAnswer = {
  routes: [{
    summary: { lengthInMeters: 2200, travelTimeInSeconds: 600, trafficDelayInSeconds: 120 },
    legs: [{ points: [{ latitude: -6.2, longitude: 106.8 }, { latitude: -6.2, longitude: 106.81 }, { latitude: -6.2, longitude: 106.82 }] }],
    sections: [
      { sectionType: 'TRAVEL_MODE', startPointIndex: 0, endPointIndex: 2 },
      { sectionType: 'TRAFFIC', startPointIndex: 1, endPointIndex: 2, magnitudeOfDelay: 3, delayInSeconds: 120 },
    ],
  }],
};

test('parseRoutes: line as [lng, lat], traffic sections become coloured spans', () => {
  const [r] = parseRoutes(tomtomAnswer);
  assert.deepEqual(r.coords, [[106.8, -6.2], [106.81, -6.2], [106.82, -6.2]]);
  assert.deepEqual(r.spans, [{ from: 1, to: 2, level: 'macet', delay: 120 }]);
  assert.equal(r.meters, 2200); assert.equal(r.delay, 120);
});

test('camerasAlong: only cameras next to the line, in driving order', () => {
  const line = [[106.8, -6.2], [106.82, -6.2]]; // ~2.2 km east-west
  const cams = [
    { id: 'far-end', lat: -6.2003, lng: 106.818 },  // ~33 m off the line, near the end
    { id: 'start', lat: -6.2, lng: 106.801 },       // on the line, near the start
    { id: 'parallel', lat: -6.2012, lng: 106.81 },  // ~130 m away: a parallel road
    { id: 'nowhere', lat: null, lng: null },
  ];
  const got = camerasAlong(line, cams);
  assert.deepEqual(got.map((c) => c.id), ['start', 'far-end']);
  assert.ok(Math.abs(got[0].at - 111) < 5, `start camera ~111 m from the start, got ${got[0].at}`);
});

test('handle: no key, bad points, then a real answer from the cache and the daily cap', async () => {
  const q = (s) => new URLSearchParams(s);
  assert.equal((await handle('/api/route', q('from=-6.2,106.8&to=-6.3,106.9'), [], '')).status, 503);
  assert.equal((await handle('/api/route', q('from=-6.2,106.8&to=1,2'), [], 'k')).status, 400);  // outside the area
  assert.equal((await handle('/api/route', q('from=abc&to=-6.3,106.9'), [], 'k')).status, 400);

  const realFetch = globalThis.fetch;
  let calls = 0, lastUrl = '';
  globalThis.fetch = async (url) => { calls++; lastUrl = url; return { ok: true, json: async () => tomtomAnswer }; };
  try {
    const cams = [{ id: 'start', lat: -6.2, lng: 106.801 }];
    const r = await handle('/api/route', q('from=-6.2,106.8&to=-6.2,106.82&mode=motor'), cams, 'k', 1e12);
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.routes[0].cameras.map((c) => c.id), ['start']);
    assert.match(lastUrl, /travelMode=motorcycle&avoid=tollRoads/);
    await handle('/api/route', q('from=-6.2,106.8&to=-6.2,106.82&mode=motor'), cams, 'k', 1e12 + 1000);
    assert.equal(calls, 1, 'same route within minutes comes from memory');

    const mobil = await handle('/api/route', q('from=-6.2,106.8&to=-6.2,106.82&mode=mobil'), cams, 'k', 1e12);
    assert.equal(mobil.status, 200);
    assert.doesNotMatch(lastUrl, /avoid=tollRoads/);

    for (let i = 0; i < DAILY.route; i++) await handle('/api/route', q(`from=-6.2,106.8&to=-6.2,${(106.7 + i / 1e4).toFixed(4)}`), [], 'k', 1e12);
    assert.equal((await handle('/api/route', q('from=-6.25,106.8&to=-6.2,106.9'), [], 'k', 1e12)).status, 429);
    assert.equal((await handle('/api/route', q('from=-6.25,106.8&to=-6.2,106.9'), [], 'k', 1e12 + 86400_000)).status, 200, 'cap resets the next day');
  } finally {
    globalThis.fetch = realFetch;
  }
});
