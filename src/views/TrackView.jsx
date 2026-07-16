import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtClock, gapAt, isOut, leaderLapAt, orderAt } from "../engine.js";
import { createReplaySource } from "../sources/replaySource.js";
import { createLiveSource, LIVE_DELAY_MS } from "../sources/liveSource.js";
import TrackCanvas from "../components/TrackCanvas.jsx";
import Leaderboard from "../components/Leaderboard.jsx";
import Controls from "../components/Controls.jsx";

const POLL_S = 4;

function fmtGap(gap, isLeader) {
  if (isLeader) return "Leader";
  if (gap == null) return "";
  if (typeof gap === "number") return `+${gap.toFixed(1)}`;
  return gap; // e.g. "+1 LAP"
}

function fmtAgo(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// The one view a racetrack gets. `kind` picks the data source feeding it:
// "replay" reads the local files under track.dataUrl, "live" streams from the
// OpenF1 API. Everything else — canvas, leaderboard, header — is shared.
export default function TrackView({ track, kind }) {
  const source = useMemo(
    () =>
      kind === "live" ? createLiveSource(track) : createReplaySource(track),
    [track, kind],
  );
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("");
  const [, setVersion] = useState(0); // bumped when source data (drivers/session) changes
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [time, setTime] = useState(0); // display time, updated each frame

  // Mutable playback clock (replay) — the RAF loop reads/writes this without renders.
  const clock = useRef({ time: 0, playing: false, speed: 10, last: null });
  clock.current.playing = playing;
  clock.current.speed = speed;
  const canvasRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    source
      .start({
        onReady: () => !cancelled && setReady(true),
        onStatus: (s) => !cancelled && setStatus(s),
        onUpdate: () => !cancelled && setVersion((v) => v + 1),
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
      source.stop();
    };
  }, [source]);

  useEffect(() => {
    if (!ready) return;
    let raf;
    const loop = (now) => {
      let t;
      if (source.kind === "replay") {
        const c = clock.current;
        const dur = source.meta.duration_ms;
        if (c.playing && c.last != null) {
          c.time = Math.min(c.time + (now - c.last) * c.speed, dur);
          if (c.time >= dur) setPlaying(false);
        }
        c.last = now;
        t = c.time;
      } else {
        t = Date.now() - LIVE_DELAY_MS;
      }
      canvasRef.current?.draw(t);
      setTime(t);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, source]);

  const togglePlay = useCallback(() => {
    const c = clock.current;
    if (!c.playing && source.meta && c.time >= source.meta.duration_ms) c.time = 0;
    setPlaying((p) => !p);
  }, [source]);

  useEffect(() => {
    if (source.kind !== "replay") return;
    const onKey = (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [source, togglePlay]);

  // Quantize the leaderboard's time so it recomputes ~4x/s, not every frame.
  const boardTime = Math.floor(time / 250) * 250;

  const { entries, lap } = useMemo(() => {
    if (!ready) return { entries: [], lap: null };
    if (source.kind === "replay") {
      const meta = source.meta;
      const order = orderAt(meta, boardTime);
      const rank = {};
      for (const o of order) rank[o.num] = o.p;
      const entries = [...source.drivers]
        .sort(
          (a, b) =>
            (rank[a.number] ?? 99) - (rank[b.number] ?? 99) ||
            a.number - b.number,
        )
        .map((d) => {
          const pos = rank[d.number];
          const out = isOut(source, d.number, boardTime);
          return {
            driver: d,
            pos,
            out,
            lead: pos === 1,
            gapText: out ? "" : fmtGap(gapAt(meta, d.number, boardTime), pos === 1),
          };
        });
      return { entries, lap: leaderLapAt(meta, order, boardTime) };
    }
    // Live: a plain legend — car number in the position slot.
    return {
      entries: source.drivers.map((d) => ({ driver: d, pos: d.number })),
      lap: null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, source, boardTime, source.drivers]);

  if (error) {
    return (
      <div className="loading">
        <div className="err">
          Could not load data ({error}).
          <br />
          For the replay, run <code>python3 fetch_data.py</code> first, then
          restart the dev server.
        </div>
      </div>
    );
  }
  if (!ready) return <div className="loading">{status || "Loading…"}</div>;

  const live = source.kind === "live";
  const session = source.session;
  const ago = live && source.newest
    ? Math.max(0, Math.round((Date.now() - source.newest) / 1000))
    : null;

  return (
    <>
      <header>
        {live ? (
          <>
            <h1>
              <span className="live-dot big" /> Live
            </h1>
            <span className="session">
              {session
                ? `${session.session_name} · ${session.location} · ${session.year}`
                : "Looking up latest session…"}
            </span>
          </>
        ) : (
          <>
            <h1>
              <span className="flag">{track.flag}</span>
              {track.replayTitle}
            </h1>
            <span className="session">{track.circuit} · Race</span>
          </>
        )}
        <span className="spacer" />
        {live ? (
          <div className="stat">
            <span className="label">Last data</span>
            <span className="value">
              {ago == null ? "—" : ago < 5 ? "now" : `${fmtAgo(ago)} ago`}
            </span>
          </div>
        ) : (
          <>
            <div className="stat">
              <span className="label">Lap</span>
              <span className="value">
                {lap} / {source.meta.total_laps}
              </span>
            </div>
            <div className="stat">
              <span className="label">Race time</span>
              <span className="value">{fmtClock(time)}</span>
            </div>
          </>
        )}
      </header>

      <main>
        <TrackCanvas
          ref={canvasRef}
          source={source}
          overlay={
            live && status ? <div className="live-status">{status}</div> : null
          }
        />
        <Leaderboard
          title={live ? "Drivers" : "Running order"}
          entries={entries}
        />
      </main>

      {live ? (
        <footer>
          <span className="live-note">
            Polls api.openf1.org every {POLL_S}s · view runs ~
            {LIVE_DELAY_MS / 1000}s behind real time
          </span>
        </footer>
      ) : (
        <Controls
          playing={playing}
          speed={speed}
          progress={time / source.meta.duration_ms}
          onTogglePlay={togglePlay}
          onSpeed={setSpeed}
          onScrub={(f) => {
            clock.current.time = f * source.meta.duration_ms;
            setTime(clock.current.time);
          }}
        />
      )}
    </>
  );
}
