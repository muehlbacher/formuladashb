const SPEEDS = [1, 2, 5, 10, 30, 60];

export default function Controls({ playing, speed, progress, onTogglePlay, onSpeed, onScrub }) {
  return (
    <footer>
      <button className="play-btn" title="Play / pause" onClick={onTogglePlay}>
        {playing ? "⏸" : "▶"}
      </button>
      <div className="speeds">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={s === speed ? "active" : ""}
            onClick={() => onSpeed(s)}
          >
            {s}×
          </button>
        ))}
      </div>
      <input
        className="scrub"
        type="range"
        min="0"
        max="1000"
        value={Math.round(progress * 1000)}
        onChange={(e) => onScrub(e.target.value / 1000)}
      />
    </footer>
  );
}
