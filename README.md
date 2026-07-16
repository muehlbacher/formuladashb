# F1 Spa 2025 Race Replay Dashboard

Replays the **2025 Belgian Grand Prix** (Circuit de Spa-Francorchamps) from real
telemetry provided by the [OpenF1 API](https://openf1.org): a bird's-eye view of
the circuit with all 20 cars as team-colored dots, a live running order, lap
counter, and playback controls.

## Setup

1. **Download the race data** (one-time, takes a few minutes due to API rate limits):

   ```sh
   python3 fetch_data.py
   ```

   This writes `data/meta.json` (session, drivers, laps, positions) and
   `data/locations.json` (downsampled ~2 Hz car coordinates for the whole race).

2. **Serve the folder over HTTP** (the page loads the JSON via `fetch`, so
   `file://` won't work):

   ```sh
   python3 -m http.server 8347
   ```

3. Open <http://localhost:8347>.

## Usage

- **▶ / Space** — play or pause the replay
- **1×–60×** — playback speed
- **Slider** — scrub to any point in the race
- **labels** checkbox — toggle driver acronyms next to the dots

Notes: the race started ~80 minutes late after heavy rain, behind the safety
car; the replay timeline starts just before lap 1. Cars that retire fade from
the track and are marked OUT in the running order.

## Data

All data comes from `api.openf1.org/v1` for `session_key=9939`
(endpoints: `drivers`, `laps`, `position`, `location`). The track outline is
drawn directly from a reference car's lap-2 GPS trace — no hand-drawn map.
