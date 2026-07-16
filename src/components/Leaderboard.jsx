import { memo } from "react";

// Presentational running order / driver legend. Entries are precomputed by
// the view: [{driver, pos?, gapText?, out?, lead?}].
const Leaderboard = memo(function Leaderboard({ title, entries }) {
  return (
    <aside>
      <h2>{title}</h2>
      <div>
        {entries.map(({ driver: d, pos, gapText, out, lead }) => {
          const cls = ["row", lead ? "p1" : "", out ? "out" : ""]
            .join(" ")
            .trim();
          return (
            <div key={d.number} className={cls}>
              <span className="pos">{pos ?? "–"}</span>
              <span className="chip" style={{ background: d.color }} />
              <span className="acr">{d.acronym}</span>
              <span className="name">{d.team}</span>
              <span className="gap">{gapText ?? ""}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
});

export default Leaderboard;
