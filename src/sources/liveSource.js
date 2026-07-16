import { loadRace, makeCarPositioner } from "../engine.js";

// OpenF1's free tier allows 30 requests/minute PER IP — shared across every
// open dashboard tab. The cadences below total ~20/min (locations 10 +
// position/intervals 8 + laps 1 + session check 1); on a 429 the loop backs
// off for a while before resuming.
const API = "https://api.openf1.org/v1";
export const POLL_MS = 6000;
const SESSION_RECHECK_MS = 60000;
const SEED_WINDOW_MS = 3 * 60e3; // backfill on connect
const TIMING_POLL_MS = 15000; // position + gap-to-leader cadence
const LAPS_POLL_MS = 60000; // lap-table refresh cadence
const BACKOFF_MS = 20000; // pause after hitting the rate limit
export const LIVE_DELAY_MS = 15000; // render behind real time for smooth motion

// Debug: open /#sim to replay the Spa 2025 race through this live pipeline,
// time-shifted so it streams as if it were happening right now.
const SIM = typeof window !== "undefined" && window.location.hash === "#sim";
const SIM_SESSION = 9939;
const SIM_START = Date.parse("2025-07-27T14:20:00Z");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Live source: polls the OpenF1 API for the latest session and appends car
// locations into growing buffers. Time is epoch ms; the view renders at
// Date.now() - LIVE_DELAY_MS. The static outline of the track (same circuit
// as the replay data) is loaded from local files so the track is visible
// before cars have driven it; live points can still expand the bounds if the
// session runs elsewhere.
export function createLiveSource(track) {
  let alive = false;

  const src = {
    kind: "live",
    drivers: [],
    locs: {}, // num -> {t: [epoch ms], x: [], y: []}
    bounds: null,
    track: null,
    session: null,
    newest: 0, // newest sample epoch ms
    carPos: null,
    // Timing data kept in the same shape as the replay meta so the view can
    // reuse orderAt/gapAt/leaderLapAt unchanged — times are epoch ms here.
    meta: { positions: [], intervals: {}, laps: {}, total_laps: null },
    raceStartMs: null, // epoch ms of the first lap-1 start (race sessions)
    async start({ onReady, onStatus, onUpdate }) {
      alive = true;
      src.carPos = makeCarPositioner(src.locs, 30000);

      // Static outline from the local replay data of this circuit.
      try {
        const race = await loadRace(track.dataUrl);
        src.track = race.track;
        src.bounds = { ...race.bounds };
      } catch {
        onStatus?.("No local track data — outline will paint as cars drive.");
      }
      onReady?.();
      poll({ onStatus, onUpdate }); // runs until stop(); errors surface as status
    },
    stop() {
      alive = false;
    },
  };

  const jget = async (path) => {
    const r = await fetch(`${API}/${path}`);
    if (r.status === 404) return []; // OpenF1's "no results found"
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  // In sim mode all API times are shifted: queries go back to 2025, and
  // returned sample times are moved forward to the present.
  const simOffset = SIM ? Date.now() - SIM_START : 0;

  const latestSession = async () => {
    const s = await jget(`sessions?session_key=${SIM ? SIM_SESSION : "latest"}`);
    return Array.isArray(s) ? s[s.length - 1] : s;
  };

  const loadDrivers = async (sessionKey, onUpdate) => {
    const drs = await jget(`drivers?session_key=${sessionKey}`);
    src.drivers = drs
      .map((d) => ({
        number: d.driver_number,
        acronym: d.name_acronym,
        name: d.full_name,
        team: d.team_name,
        color: "#" + (d.team_colour || "888888"),
      }))
      .sort((a, b) => a.number - b.number);
    onUpdate?.();
  };

  let lastDate = null; // newest location sample date string seen (poll cursor)
  let posCursor = null; // position feed cursor (null = fetch from session start)
  let intCursor = null; // intervals feed cursor (null = fetch from session start)
  let lastTimingAt = 0;
  let lastLapsAt = 0;

  // Sim mode caps queries at shifted "now" so data arrives poll by poll,
  // like a real session; live queries have no future data anyway.
  const simUpper = () =>
    SIM
      ? `&date<${encodeURIComponent(
          new Date(Date.now() - simOffset).toISOString().slice(0, 23),
        )}`
      : "";

  const resetBuffers = () => {
    // Clear in place so carPos keeps working on the same refs.
    for (const k of Object.keys(src.locs)) delete src.locs[k];
    for (const k of Object.keys(src.meta.intervals)) delete src.meta.intervals[k];
    for (const k of Object.keys(src.meta.laps)) delete src.meta.laps[k];
    src.meta.positions.length = 0;
    src.raceStartMs = null;
    src.newest = 0;
    lastDate = null;
    posCursor = null;
    intCursor = null;
    lastTimingAt = 0;
    lastLapsAt = 0;
  };

  // Running order, gaps to the leader, and the lap table. Races publish all
  // three; practice/qualifying may lack intervals — those queries just come
  // back empty and the leaderboard shows what exists.
  async function pollTiming(sessionKey, onUpdate) {
    const now = Date.now();
    if (now - lastTimingAt >= TIMING_POLL_MS) {
      lastTimingAt = now;
      const posRows = await jget(
        `position?session_key=${sessionKey}` +
          (posCursor ? `&date>${encodeURIComponent(posCursor)}` : "") +
          simUpper(),
      );
      for (const r of posRows) {
        src.meta.positions.push([
          Date.parse(r.date) + simOffset,
          r.driver_number,
          r.position,
        ]);
      }
      if (posRows.length) posCursor = posRows[posRows.length - 1].date.slice(0, 23);

      const intRows = await jget(
        `intervals?session_key=${sessionKey}` +
          (intCursor ? `&date>${encodeURIComponent(intCursor)}` : "") +
          simUpper(),
      );
      for (const r of intRows) {
        const d = (src.meta.intervals[String(r.driver_number)] ??= {
          t: [],
          g: [],
        });
        const t = Date.parse(r.date) + simOffset;
        if (d.t.length && t <= d.t[d.t.length - 1]) continue;
        d.t.push(t);
        d.g.push(r.gap_to_leader);
      }
      if (intRows.length) intCursor = intRows[intRows.length - 1].date.slice(0, 23);
      if (posRows.length || intRows.length) onUpdate?.();
    }

    if (now - lastLapsAt >= LAPS_POLL_MS) {
      lastLapsAt = now;
      const lapRows = await jget(`laps?session_key=${sessionKey}`);
      const laps = {};
      let raceStart = null;
      for (const l of lapRows) {
        if (!l.date_start) continue;
        const t = Date.parse(l.date_start) + simOffset;
        if (SIM && t > Date.now()) continue;
        (laps[String(l.driver_number)] ??= []).push([l.lap_number, t]);
        if (l.lap_number === 1 && (raceStart == null || t < raceStart)) {
          raceStart = t;
        }
      }
      for (const v of Object.values(laps)) v.sort((a, b) => a[0] - b[0]);
      src.meta.laps = laps;
      src.raceStartMs = raceStart;
      onUpdate?.();
    }
  }

  async function poll({ onStatus, onUpdate }) {
    onStatus?.("Connecting to OpenF1…");
    let sess = null;
    while (alive && !sess) {
      try {
        sess = await latestSession();
      } catch (e) {
        onStatus?.(`Cannot reach OpenF1 (${e.message}) — retrying…`);
        await sleep(8000);
      }
    }
    if (!alive) return;
    src.session = sess;
    onUpdate?.();
    try {
      await loadDrivers(sess.session_key, onUpdate);
    } catch {
      /* legend fills in on a later session recheck */
    }

    let lastSessionCheck = Date.now();
    let backoffUntil = 0;
    while (alive) {
      // Stand back for a while after hitting the shared rate limit.
      if (Date.now() < backoffUntil) {
        await sleep(2000);
        continue;
      }
      // A new session (e.g. next practice) may have started: switch to it.
      if (Date.now() - lastSessionCheck > SESSION_RECHECK_MS) {
        lastSessionCheck = Date.now();
        try {
          const s = await latestSession();
          if (s.session_key !== sess.session_key) {
            sess = s;
            resetBuffers();
            src.session = s;
            onUpdate?.();
            await loadDrivers(s.session_key, onUpdate);
          }
        } catch {
          /* keep polling the session we have */
        }
      }

      try {
        const since =
          lastDate ??
          new Date(Date.now() - SEED_WINDOW_MS - simOffset)
            .toISOString()
            .slice(0, 23);
        const rows = await jget(
          `location?session_key=${sess.session_key}&date>${encodeURIComponent(since)}${simUpper()}`,
        );
        if (rows.length) {
          for (const r of rows) {
            if (r.x === 0 && r.y === 0) continue; // telemetry dropout
            const key = String(r.driver_number);
            const d = (src.locs[key] ??= { t: [], x: [], y: [] });
            const t = Date.parse(r.date) + simOffset;
            if (d.t.length && t <= d.t[d.t.length - 1]) continue;
            d.t.push(t);
            d.x.push(r.x);
            d.y.push(r.y);
            if (t > src.newest) src.newest = t;
            const b = src.bounds;
            if (!b) {
              src.bounds = { minX: r.x, maxX: r.x, minY: r.y, maxY: r.y };
            } else {
              if (r.x < b.minX) b.minX = r.x;
              if (r.x > b.maxX) b.maxX = r.x;
              if (r.y < b.minY) b.minY = r.y;
              if (r.y > b.maxY) b.maxY = r.y;
            }
          }
          lastDate = rows[rows.length - 1].date.slice(0, 23);
          onStatus?.("");
        } else if (!src.newest) {
          onStatus?.("Waiting for live data — no cars on track right now.");
        }
      } catch (e) {
        if (String(e.message).includes("429")) {
          backoffUntil = Date.now() + BACKOFF_MS;
          onStatus?.("OpenF1 rate limit hit — pausing briefly…");
        } else {
          onStatus?.(`Data fetch failed (${e.message}) — retrying…`);
        }
      }
      try {
        await pollTiming(sess.session_key, onUpdate);
      } catch (e) {
        // timing is best-effort; car dots keep working without it
        if (String(e.message).includes("429")) {
          backoffUntil = Date.now() + BACKOFF_MS;
        } else {
          console.warn("timing fetch failed:", e.message);
        }
      }
      await sleep(POLL_MS);
    }
  }

  if (import.meta.env.DEV) window.__liveSource = src; // debugging hook
  return src;
}
