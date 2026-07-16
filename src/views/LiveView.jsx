import { useEffect, useRef, useState } from "react";
import { lowerBound } from "../engine.js";

const API = "https://api.openf1.org/v1";
const POLL_MS = 4000;
const SESSION_RECHECK_MS = 60000;
const LIVE_DELAY_MS = 15000; // render behind real time so dots move smoothly
const SEED_WINDOW_MS = 3 * 60e3; // backfill on connect

// Debug: open /#sim to replay the Spa 2025 race through this live pipeline,
// time-shifted so it streams as if it were happening right now.
const SIM = typeof window !== "undefined" && window.location.hash === "#sim";
const SIM_SESSION = 9939;
const SIM_START = Date.parse("2025-07-27T14:20:00Z");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fmtAgo(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function LiveView() {
  const [session, setSession] = useState(null);
  const [drivers, setDrivers] = useState([]);
  const [status, setStatus] = useState("Connecting to OpenF1…");
  const [, setTick] = useState(0); // 1 Hz re-render for the "last data" stat
  const canvasRef = useRef(null);
  const st = useRef({
    locs: {}, // num -> {t: [epoch ms], x: [], y: []}
    bounds: null,
    lastDate: null, // newest sample date string seen (poll cursor)
    newest: 0, // newest sample epoch ms
    drivers: [],
    off: null, // offscreen canvas holding the painted driven line
    painted: {}, // num -> next point index to paint onto `off`
    dirty: true, // offscreen needs a full repaint (bounds/size changed)
  }).current;

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ---------- polling ----------
  useEffect(() => {
    let alive = true;

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
      const s = await jget(
        `sessions?session_key=${SIM ? SIM_SESSION : "latest"}`,
      );
      return Array.isArray(s) ? s[s.length - 1] : s;
    };

    const loadDrivers = async (sessionKey) => {
      const drs = await jget(`drivers?session_key=${sessionKey}`);
      const mapped = drs
        .map((d) => ({
          number: d.driver_number,
          acronym: d.name_acronym,
          name: d.full_name,
          team: d.team_name,
          color: "#" + (d.team_colour || "888888"),
        }))
        .sort((a, b) => a.number - b.number);
      st.drivers = mapped;
      if (alive) setDrivers(mapped);
    };

    (async () => {
      let sess = null;
      while (alive && !sess) {
        try {
          sess = await latestSession();
        } catch (e) {
          setStatus(`Cannot reach OpenF1 (${e.message}) — retrying…`);
          await sleep(8000);
        }
      }
      if (!alive) return;
      setSession(sess);
      try {
        await loadDrivers(sess.session_key);
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
              Object.assign(st, {
                locs: {},
                bounds: null,
                lastDate: null,
                newest: 0,
                painted: {},
                dirty: true,
              });
              setSession(s);
              await loadDrivers(s.session_key);
            }
          } catch {
            /* keep polling the session we have */
          }
        }

        try {
          const since =
            st.lastDate ??
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
              const d = (st.locs[key] ??= { t: [], x: [], y: [] });
              const t = Date.parse(r.date) + simOffset;
              if (d.t.length && t <= d.t[d.t.length - 1]) continue;
              d.t.push(t);
              d.x.push(r.x);
              d.y.push(r.y);
              if (t > st.newest) st.newest = t;
              const b = st.bounds;
              if (!b) {
                st.bounds = { minX: r.x, maxX: r.x, minY: r.y, maxY: r.y };
                st.dirty = true;
              } else {
                if (r.x < b.minX) (b.minX = r.x), (st.dirty = true);
                if (r.x > b.maxX) (b.maxX = r.x), (st.dirty = true);
                if (r.y < b.minY) (b.minY = r.y), (st.dirty = true);
                if (r.y > b.maxY) (b.maxY = r.y), (st.dirty = true);
              }
            }
            st.lastDate = rows[rows.length - 1].date.slice(0, 23);
            setStatus("");
          } else if (!st.newest) {
            setStatus(
              "Waiting for live data — no cars on track in the last 10 minutes.",
            );
          }
        } catch (e) {
          setStatus(`Data fetch failed (${e.message}) — retrying…`);
        }
        await sleep(POLL_MS);
      }
    })();

    return () => {
      alive = false;
    };
  }, [st]);

  // ---------- drawing ----------
  useEffect(() => {
    let raf;

    const interp = (d, t) => {
      const n = d.t.length;
      if (!n || t <= d.t[0]) return null;
      if (t >= d.t[n - 1]) {
        // hold the last known spot briefly (pit box); hide when long stale
        return t - d.t[n - 1] > 120000 ? null : { x: d.x[n - 1], y: d.y[n - 1] };
      }
      const i = lowerBound(d.t, t);
      const t0 = d.t[i - 1],
        t1 = d.t[i],
        gap = t1 - t0;
      if (gap > 8000) return { x: d.x[i - 1], y: d.y[i - 1] };
      const f = (t - t0) / gap;
      return {
        x: d.x[i - 1] + (d.x[i] - d.x[i - 1]) * f,
        y: d.y[i - 1] + (d.y[i] - d.y[i - 1]) * f,
      };
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        st.dirty = true;
      }
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const b = st.bounds;
      if (!b) return;

      const pad = Math.min(34, Math.min(w, h) * 0.08);
      const worldW = Math.max(b.maxX - b.minX, 1),
        worldH = Math.max(b.maxY - b.minY, 1);
      const s = Math.min((w - 2 * pad) / worldW, (h - 2 * pad) / worldH);
      const ox = (w - worldW * s) / 2,
        oy = (h - worldH * s) / 2;
      const tx = (x) => ox + (x - b.minX) * s;
      const ty = (y) => oy + (b.maxY - y) * s;
      const JUMP_DIST = 1500; // world units; break the line on pit/garage jumps
      const JUMP_TIME = 5000;

      // The driven line accumulates on an offscreen canvas: each frame paints
      // only the new samples; bounds/size changes trigger one full repaint.
      if (!st.off) st.off = document.createElement("canvas");
      if (st.off.width !== w * dpr || st.off.height !== h * dpr) {
        st.off.width = w * dpr;
        st.off.height = h * dpr;
        st.dirty = true;
      }
      const octx = st.off.getContext("2d");
      octx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (st.dirty) {
        octx.clearRect(0, 0, w, h);
        st.painted = {};
        st.dirty = false;
      }
      octx.lineJoin = "round";
      octx.lineCap = "round";
      octx.strokeStyle = "#343a47";
      octx.lineWidth = 9;
      for (const [num, d] of Object.entries(st.locs)) {
        const from = st.painted[num] ?? 0;
        if (d.t.length - from < 1 || d.t.length < 2) continue;
        octx.beginPath();
        let started = false;
        for (let i = Math.max(from, 1); i < d.t.length; i++) {
          const jump =
            d.t[i] - d.t[i - 1] > JUMP_TIME ||
            Math.hypot(d.x[i] - d.x[i - 1], d.y[i] - d.y[i - 1]) > JUMP_DIST;
          if (jump) {
            started = false;
            continue;
          }
          if (!started) {
            octx.moveTo(tx(d.x[i - 1]), ty(d.y[i - 1]));
            started = true;
          }
          octx.lineTo(tx(d.x[i]), ty(d.y[i]));
        }
        octx.stroke();
        st.painted[num] = d.t.length;
      }
      ctx.drawImage(st.off, 0, 0, w, h);

      // cars at delayed "now"
      const rt = Date.now() - LIVE_DELAY_MS;
      ctx.font = "600 10px -apple-system, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      const drs = st.drivers.length
        ? st.drivers
        : Object.keys(st.locs).map((n) => ({
            number: +n,
            acronym: "#" + n,
            color: "#8ea0b8",
          }));
      for (const drv of drs) {
        const d = st.locs[String(drv.number)];
        if (!d) continue;
        const p = interp(d, rt);
        if (!p) continue;
        const x = tx(p.x),
          y = ty(p.y);
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = drv.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(10,12,16,.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "rgba(232,234,240,.85)";
        ctx.fillText(drv.acronym, x + 8, y);
      }
    };

    const loop = () => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [st]);

  const ago = st.newest ? Math.max(0, Math.round((Date.now() - st.newest) / 1000)) : null;

  return (
    <>
      <header>
        <h1>
          <span className="live-dot big" /> Live
        </h1>
        <span className="session">
          {session
            ? `${session.session_name} · ${session.location} · ${session.year}`
            : "Looking up latest session…"}
        </span>
        <span className="spacer" />
        <div className="stat">
          <span className="label">Last data</span>
          <span className="value">
            {ago == null ? "—" : ago < 5 ? "now" : `${fmtAgo(ago)} ago`}
          </span>
        </div>
      </header>

      <main>
        <div className="track-panel">
          <canvas ref={canvasRef} />
          {status && <div className="live-status">{status}</div>}
        </div>
        <aside>
          <h2>Drivers</h2>
          <div>
            {drivers.map((d) => (
              <div key={d.number} className="row">
                <span className="pos">{d.number}</span>
                <span className="chip" style={{ background: d.color }} />
                <span className="acr">{d.acronym}</span>
                <span className="name">{d.team}</span>
              </div>
            ))}
          </div>
        </aside>
      </main>

      <footer>
        <span className="live-note">
          Polls api.openf1.org every {POLL_MS / 1000}s · view runs ~
          {LIVE_DELAY_MS / 1000}s behind real time · the track outline paints
          itself as cars complete laps
        </span>
      </footer>
    </>
  );
}
