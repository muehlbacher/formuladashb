import { loadRace, makeCarPositioner } from "../engine.js";

const API = "https://api.openf1.org/v1";
const POLL_MS = 4000;
const SESSION_RECHECK_MS = 60000;
const SEED_WINDOW_MS = 3 * 60e3; // backfill on connect
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

  let lastDate = null; // newest sample date string seen (poll cursor)

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
    while (alive) {
      // A new session (e.g. next practice) may have started: switch to it.
      if (Date.now() - lastSessionCheck > SESSION_RECHECK_MS) {
        lastSessionCheck = Date.now();
        try {
          const s = await latestSession();
          if (s.session_key !== sess.session_key) {
            sess = s;
            // Clear buffers in place so carPos keeps working on the same refs.
            for (const k of Object.keys(src.locs)) delete src.locs[k];
            lastDate = null;
            src.newest = 0;
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
        // Sim mode caps the query at shifted "now" so data arrives poll by
        // poll, like a real session; live queries have no future data anyway.
        const upper = SIM
          ? `&date<${encodeURIComponent(
              new Date(Date.now() - simOffset).toISOString().slice(0, 23),
            )}`
          : "";
        const rows = await jget(
          `location?session_key=${sess.session_key}&date>${encodeURIComponent(since)}${upper}`,
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
        onStatus?.(`Data fetch failed (${e.message}) — retrying…`);
      }
      await sleep(POLL_MS);
    }
  }

  return src;
}
