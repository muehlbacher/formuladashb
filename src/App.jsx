import { useState } from "react";
import Sidebar from "./components/Sidebar.jsx";
import ReplayView from "./views/ReplayView.jsx";
import LiveView from "./views/LiveView.jsx";

const SOURCES = [
  {
    id: "live",
    label: "Live",
    sub: "Latest OpenF1 session",
    live: true,
  },
  {
    id: "spa2025",
    label: "2025 Belgian Grand Prix",
    sub: "Race replay · Spa-Francorchamps",
  },
];

export default function App() {
  const [source, setSource] = useState("spa2025");
  return (
    <div className="layout">
      <Sidebar sources={SOURCES} active={source} onSelect={setSource} />
      <div className="view">
        {source === "live" ? <LiveView /> : <ReplayView key={source} />}
      </div>
    </div>
  );
}
