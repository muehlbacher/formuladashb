# F1 Spa 2025 Race Replay Dashboard

A React app that replays the **2025 Belgian Grand Prix** (Circuit de
Spa-Francorchamps) from real telemetry provided by the
[OpenF1 API](https://openf1.org): a bird's-eye view of the circuit with all 20
cars as team-colored dots, a live running order, lap counter, and playback
controls.

## Setup

1. **Download the race data** (one-time, takes a few minutes due to API rate
   limits; the output is gitignored):

   ```sh
   python3 fetch_data.py
   ```

   This writes `public/data/meta.json` (session, drivers, laps, positions) and
   `public/data/locations.json` (downsampled ~2 Hz car coordinates for the
   whole race).

2. **Install and run**:

   ```sh
   npm install
   npm run dev
   ```

3. Open <http://localhost:8347>. (`npm run build` produces a static production
   bundle in `dist/`, data included.)

## Usage

The left sidebar picks the source:

- **Live** — follows the latest OpenF1 session in (near) real time: it polls
  `api.openf1.org` every 4 s, renders ~15 s behind real time so car motion is
  smooth, and the track outline paints itself as cars complete laps. When no
  session is running it shows a waiting state. Open `/#sim` to dry-run this
  view against the 2025 Spa race streamed as if it were live.
- **2025 Belgian Grand Prix** — the full race replay:
  - **▶ / Space** — play or pause the replay
  - **1×–60×** — playback speed
  - **Slider** — scrub to any point in the race
  - **labels** checkbox — toggle driver acronyms next to the dots
  - The running order shows each driver's live gap to the leader
    (from the OpenF1 `intervals` endpoint).

Notes: the race started ~80 minutes late after heavy rain, behind the safety
car; the replay timeline starts just before lap 1. Cars that retire fade from
the track and are marked OUT in the running order.

## Architecture

There is **one view per racetrack** (`TrackView`, currently only Spa); the
sidebar selection picks the **data source** that feeds it — local files for
the 2025 race replay, the OpenF1 API stream for Live. Both sources expose the
same interface (`drivers`, `locs` buffers, `bounds`, `track` outline,
`carPos(num, t)` interpolation), so the canvas and leaderboard don't care
where the data comes from.

- `fetch_data.py` — one-time downloader/preprocessor (Python stdlib only)
- `src/engine.js` — data loading, coordinate math, car interpolation, race state
- `src/tracks.js` — track configs + sidebar source entries
- `src/sources/replaySource.js` — local-JSON source (complete race, offset time)
- `src/sources/liveSource.js` — API polling source (growing buffers, epoch
  time, ~15 s render delay; `#sim` streams the 2025 Spa race through the same
  pipeline). Loads the local track outline so the circuit is visible before
  cars have driven it.
- `src/views/TrackView.jsx` — the per-racetrack view: RAF loop, header,
  playback controls (replay) or live status (live)
- `src/App.jsx` / `src/components/Sidebar.jsx` — source picker
- `src/components/TrackCanvas.jsx` — canvas layers: outline, driven trail
  (live), cars — drawn imperatively so car motion never goes through React state
- `src/components/Leaderboard.jsx` — running order + gap to leader, or plain
  driver legend in live mode
- `src/components/Controls.jsx` — play/pause, speed, scrubber

All replay data comes from `api.openf1.org/v1` for `session_key=9939`
(endpoints: `drivers`, `laps`, `position`, `intervals`, `location`). The track
outline is drawn directly from a reference car's lap-2 GPS trace — no
hand-drawn map.
