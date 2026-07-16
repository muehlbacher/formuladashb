import { memo } from "react";
import { isOut, orderAt } from "../engine.js";

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
          const cls = [
            "row",
            p === 1 ? "p1" : "",
            isOut(race, d.number, time) ? "out" : "",
          ]
            .join(" ")
            .trim();
          return (
            <div key={d.number} className={cls}>
              <span className="pos">{p ?? "–"}</span>
              <span className="chip" style={{ background: d.color }} />
              <span className="acr">{d.acronym}</span>
              <span className="name">{d.team}</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
});

export default Leaderboard;
