import { memo } from "react";
import { gapAt, isOut, orderAt } from "../engine.js";

function fmtGap(gap, isLeader) {
  if (isLeader) return "Leader";
  if (gap == null) return "";
  if (typeof gap === "number") return `+${gap.toFixed(1)}`;
  return gap; // e.g. "+1 LAP"
}

// time arrives quantized (~4/s) from App so this only re-renders on change.
const Leaderboard = memo(function Leaderboard({ race, time }) {
  const order = orderAt(race.meta, time);
  const rank = {};
  for (const o of order) rank[o.num] = o.p;
  const sorted = [...race.meta.drivers].sort(
    (a, b) => (rank[a.number] ?? 99) - (rank[b.number] ?? 99) || a.number - b.number,
  );

  return (
    <aside>
      <h2>Running order</h2>
      <div>
        {sorted.map((d) => {
          const p = rank[d.number];
          const out = isOut(race, d.number, time);
          const cls = ["row", p === 1 ? "p1" : "", out ? "out" : ""]
            .join(" ")
            .trim();
          return (
            <div key={d.number} className={cls}>
              <span className="pos">{p ?? "–"}</span>
              <span className="chip" style={{ background: d.color }} />
              <span className="acr">{d.acronym}</span>
              <span className="name">{d.team}</span>
              <span className="gap">
                {out ? "" : fmtGap(gapAt(race.meta, d.number, time), p === 1)}
              </span>
            </div>
          );
        })}
      </div>
    </aside>
  );
});

export default Leaderboard;
