import { useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import TrackView from "./views/TrackView.jsx";
import { SOURCES, TRACKS } from "./tracks.js";

export default function App() {
  const [sourceId, setSourceId] = useState("spa2025");
  const selected = SOURCES.find((s) => s.id === sourceId);
  return (
    <div className="layout">
      <Sidebar sources={SOURCES} active={sourceId} onSelect={setSourceId} />
      <div className="view">
        <TrackView
          key={selected.id}
          track={TRACKS[selected.trackId]}
          kind={selected.kind}
        />
      </div>
    </div>
  );
}
