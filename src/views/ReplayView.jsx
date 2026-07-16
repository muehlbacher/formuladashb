import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtClock, leaderLapAt, loadRace, orderAt } from "../engine.js";
import TrackCanvas from "../components/TrackCanvas.jsx";
import Leaderboard from "../components/Leaderboard.jsx";
import Controls from "../components/Controls.jsx";

export default function ReplayView() {
  const [race, setRace] = useState(null);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(10);
  const [time, setTime] = useState(0); // display time, updated each frame

  // Mutable playback clock — the RAF loop reads/writes this without renders.
  const clock = useRef({ time: 0, playing: false, speed: 10, last: null });
  clock.current.playing = playing;
  clock.current.speed = speed;
  const canvasRef = useRef(null);

  useEffect(() => {
    loadRace().then(setRace, (e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!race) return;
    let raf;
    const loop = (now) => {
      const c = clock.current;
      if (c.playing && c.last != null) {
        c.time = Math.min(c.time + (now - c.last) * c.speed, race.meta.duration_ms);
        if (c.time >= race.meta.duration_ms) setPlaying(false);
      }
      c.last = now;
      canvasRef.current?.draw(c.time);
      setTime(c.time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [race]);

  const togglePlay = useCallback(() => {
    const c = clock.current;
    if (!c.playing && race && c.time >= race.meta.duration_ms) c.time = 0;
    setPlaying((p) => !p);
  }, [race]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === "Space" && e.target.tagName !== "INPUT") {
        e.preventDefault();
        togglePlay();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  // Quantize the leaderboard's time so it recomputes ~4x/s, not every frame.
  const boardTime = Math.floor(time / 250) * 250;
  const lap = useMemo(() => {
    if (!race) return null;
    return leaderLapAt(race.meta, orderAt(race.meta, boardTime), boardTime);
  }, [race, boardTime]);

  if (error) {
    return (
      <div className="loading">
        <div className="err">
          Could not load race data ({error}).
          <br />
          Run <code>python3 fetch_data.py</code> first, then restart the dev server.
        </div>
      </div>
    );
  }
  if (!race) return <div className="loading">Loading race data…</div>;

  return (
    <>
      <header>
        <h1>
          <span className="flag">🇧🇪</span>2025 Belgian Grand Prix
        </h1>
        <span className="session">Circuit de Spa-Francorchamps · Race</span>
        <span className="spacer" />
        <div className="stat">
          <span className="label">Lap</span>
          <span className="value">
            {lap} / {race.meta.total_laps}
          </span>
        </div>
        <div className="stat">
          <span className="label">Race time</span>
          <span className="value">{fmtClock(time)}</span>
        </div>
      </header>

      <main>
        <TrackCanvas ref={canvasRef} race={race} />
        <Leaderboard race={race} time={boardTime} />
      </main>

      <Controls
        playing={playing}
        speed={speed}
        progress={time / race.meta.duration_ms}
        onTogglePlay={togglePlay}
        onSpeed={setSpeed}
        onScrub={(f) => {
          clock.current.time = f * race.meta.duration_ms;
          setTime(clock.current.time);
        }}
      />
    </>
  );
}
