// Data loading, geometry, and race-state logic for the Spa 2025 replay.
// All times are ms offsets from meta.race_start.

export async function loadRace() {
  const [meta, locs] = await Promise.all([
    fetch("/data/meta.json").then((r) => {
      if (!r.ok) throw new Error("meta.json: " + r.status);
      return r.json();
    }),
    fetch("/data/locations.json").then((r) => {
      if (!r.ok) throw new Error("locations.json: " + r.status);
      return r.json();
    }),
  ]);
  return {
    meta,
    locs,
    bounds: computeBounds(locs),
    track: buildTrack(meta, locs),
    carPos: makeCarPositioner(locs),
  };
}

// index of first element >= v
export function lowerBound(arr, v) {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function computeBounds(locs) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const d of Object.values(locs)) {
    for (let i = 0; i < d.x.length; i++) {
      if (d.x[i] < minX) minX = d.x[i];
      if (d.x[i] > maxX) maxX = d.x[i];
      if (d.y[i] < minY) minY = d.y[i];
      if (d.y[i] > maxY) maxY = d.y[i];
    }
  }
  return { minX, maxX, minY, maxY };
}

// Track outline from a clean reference lap (a finisher's lap 2).
function buildTrack(meta, locs) {
  const candidates = Object.keys(meta.laps).sort(
    (a, b) => meta.laps[b].length - meta.laps[a].length,
  );
  for (const num of candidates) {
    const laps = meta.laps[num];
    const l2 = laps.find((l) => l[0] === 2);
    const l3 = laps.find((l) => l[0] === 3);
    const d = locs[num];
    if (!l2 || !l3 || !d) continue;
    const i0 = lowerBound(d.t, l2[1]);
    const i1 = lowerBound(d.t, l3[1]);
    if (i1 - i0 < 50) continue;
    const points = [];
    for (let i = i0; i < i1; i++) points.push([d.x[i], d.y[i]]);
    // Start/finish: lap-boundary point, normal = perpendicular of travel dir.
    const [x0, y0] = points[0];
    const [x1, y1] = points[2];
    const dx = x1 - x0,
      dy = y1 - y0,
      len = Math.hypot(dx, dy) || 1;
    return {
      points,
      startFinish: { x: x0, y: y0, nx: -dy / len, ny: dx / len },
    };
  }
  return null;
}

// Interpolated world position of a driver at time t; null if no data.
// Keeps a per-driver cursor so sequential playback is O(1) per frame.
function makeCarPositioner(locs) {
  const cursor = {};
  return function carPos(num, t) {
    const d = locs[num];
    if (!d || d.t.length === 0) return null;
    if (t < d.t[0] - 5000 || t > d.t[d.t.length - 1] + 5000) return null;
    let i = cursor[num] ?? 0;
    if (i >= d.t.length || d.t[i] > t || (i > 0 && d.t[i - 1] > t)) {
      i = lowerBound(d.t, t);
    } else {
      while (i < d.t.length && d.t[i] < t) i++;
    }
    cursor[num] = i;
    if (i === 0) return { x: d.x[0], y: d.y[0] };
    if (i >= d.t.length) {
      return { x: d.x[d.t.length - 1], y: d.y[d.t.length - 1] };
    }
    const t0 = d.t[i - 1],
      t1 = d.t[i];
    const gap = t1 - t0;
    // Red flag / pit box gap: hold position instead of interpolating.
    if (gap > 8000) return { x: d.x[i - 1], y: d.y[i - 1] };
    const f = (t - t0) / gap;
    return {
      x: d.x[i - 1] + (d.x[i] - d.x[i - 1]) * f,
      y: d.y[i - 1] + (d.y[i] - d.y[i - 1]) * f,
    };
  };
}

// Running order at time t from the position feed: [{num, p}] sorted by p.
export function orderAt(meta, t) {
  const pos = {};
  for (const [ts, num, p] of meta.positions) {
    if (ts > t) break;
    pos[num] = p;
  }
  return Object.entries(pos)
    .map(([num, p]) => ({ num: +num, p }))
    .sort((a, b) => a.p - b.p);
}

// Lap of whichever driver runs P1 at time t.
export function leaderLapAt(meta, order, t) {
  const leader = order.find((o) => o.p === 1);
  const scan = leader ? [String(leader.num)] : Object.keys(meta.laps);
  let lap = 1;
  for (const num of scan) {
    for (const [n, ts] of meta.laps[num] || []) {
      if (ts <= t && n > lap) lap = n;
    }
  }
  return lap;
}

export function isOut(race, num, t) {
  const d = race.locs[num];
  if (!d || !d.t.length) return true;
  return t > d.t[d.t.length - 1] + 30000 && t < race.meta.duration_ms - 1;
}

export function fmtClock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  const mm = String(m).padStart(2, "0"),
    ss = String(sec).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
