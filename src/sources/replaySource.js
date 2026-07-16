import { loadRace } from "../engine.js";

// Replay source: the complete race from the local JSON files under
// track.dataUrl. Time is a ms offset into the race, driven by the view's
// playback clock.
export function createReplaySource(track) {
  const src = {
    kind: "replay",
    drivers: [],
    locs: {},
    bounds: null,
    track: null, // {points, startFinish}
    meta: null, // laps/positions/intervals for order, gaps, lap counter
    carPos: () => null,
    async start({ onReady, onStatus }) {
      onStatus?.("Loading race data…");
      const race = await loadRace(track.dataUrl);
      src.meta = race.meta;
      src.drivers = race.meta.drivers;
      src.locs = race.locs;
      src.bounds = race.bounds;
      src.track = race.track;
      src.carPos = race.carPos;
      onStatus?.("");
      onReady?.();
    },
    stop() {},
  };
  return src;
}
