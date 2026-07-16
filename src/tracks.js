// One view per racetrack: each TRACKS entry describes a circuit the dashboard
// can render; SOURCES are the sidebar entries that feed that view with data —
// either a local replay (public/data) or the live OpenF1 stream.

export const TRACKS = {
  spa: {
    id: "spa",
    name: "Belgian Grand Prix",
    circuit: "Circuit de Spa-Francorchamps",
    flag: "🇧🇪",
    dataUrl: "/data",
    replayTitle: "2025 Belgian Grand Prix",
  },
};

export const SOURCES = [
  {
    id: "live",
    trackId: "spa",
    kind: "live",
    label: "Live",
    sub: "Latest OpenF1 session",
    live: true,
  },
  {
    id: "spa2025",
    trackId: "spa",
    kind: "replay",
    label: "2025 Belgian Grand Prix",
    sub: "Race replay · Spa-Francorchamps",
  },
];
