import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const CSS = (v) =>
  getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const JUMP_DIST = 1500; // world units; break the trail on pit/garage jumps
const JUMP_TIME = 5000;

// Imperative canvas over a data source (replay or live): the view's animation
// loop calls ref.draw(time) every frame, so car motion never goes through
// React state. Layers, bottom to top: static track outline (if the source has
// one), the driven-line trail (live sources — painted incrementally onto an
// offscreen canvas), cars with labels.
const TrackCanvas = forwardRef(function TrackCanvas({ source, overlay }, ref) {
  const canvasRef = useRef(null);
  const [showLabels, setShowLabels] = useState(true);
  const showLabelsRef = useRef(true);
  showLabelsRef.current = showLabels;
  const lastTime = useRef(0);
  // Trail bookkeeping: offscreen canvas + how much of each buffer is painted.
  const trail = useRef({ off: null, painted: {}, key: "" }).current;

  useImperativeHandle(ref, () => ({
    draw(time) {
      lastTime.current = time;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth,
        h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const { bounds, track, carPos } = source;
      if (!bounds) return;

      // Fit world coords into the canvas, y flipped so north stays up.
      const pad = Math.min(34, Math.min(w, h) * 0.08);
      const worldW = Math.max(bounds.maxX - bounds.minX, 1),
        worldH = Math.max(bounds.maxY - bounds.minY, 1);
      const s = Math.min((w - 2 * pad) / worldW, (h - 2 * pad) / worldH);
      const ox = (w - worldW * s) / 2,
        oy = (h - worldH * s) / 2;
      const tx = (x) => ox + (x - bounds.minX) * s;
      const ty = (y) => oy + (bounds.maxY - y) * s;

      if (track) {
        const pts = track.points;
        ctx.beginPath();
        ctx.moveTo(tx(pts[0][0]), ty(pts[0][1]));
        for (let i = 1; i < pts.length; i++) ctx.lineTo(tx(pts[i][0]), ty(pts[i][1]));
        ctx.closePath();
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.strokeStyle = CSS("--track-edge");
        ctx.lineWidth = 16;
        ctx.stroke();
        ctx.strokeStyle = CSS("--track");
        ctx.lineWidth = 12;
        ctx.stroke();

        // start/finish line
        const sf = track.startFinish,
          L = 11;
        ctx.beginPath();
        ctx.moveTo(tx(sf.x) - sf.nx * L, ty(sf.y) + sf.ny * L);
        ctx.lineTo(tx(sf.x) + sf.nx * L, ty(sf.y) - sf.ny * L);
        ctx.strokeStyle = "#dfe3ea";
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      if (source.kind === "live") drawTrail(w, h, dpr, ctx, tx, ty);

      // cars
      ctx.font = "600 10px -apple-system, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      const drivers = source.drivers.length
        ? source.drivers
        : Object.keys(source.locs).map((n) => ({
            number: +n,
            acronym: "#" + n,
            color: "#8ea0b8",
          }));
      for (const d of drivers) {
        const p = carPos(d.number, time);
        if (!p) continue;
        const x = tx(p.x),
          y = ty(p.y);
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = d.color;
        ctx.fill();
        ctx.strokeStyle = "rgba(10,12,16,.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
        if (showLabelsRef.current) {
          ctx.fillStyle = "rgba(232,234,240,.85)";
          ctx.fillText(d.acronym, x + 8, y);
        }
      }
    },
  }));

  // The trail accumulates on an offscreen canvas: each frame paints only new
  // samples; a bounds or size change triggers one full repaint.
  function drawTrail(w, h, dpr, ctx, tx, ty) {
    const b = source.bounds;
    const key = `${b.minX},${b.maxX},${b.minY},${b.maxY},${w},${h}`;
    if (!trail.off) trail.off = document.createElement("canvas");
    if (trail.off.width !== w * dpr || trail.off.height !== h * dpr) {
      trail.off.width = w * dpr;
      trail.off.height = h * dpr;
      trail.key = "";
    }
    const octx = trail.off.getContext("2d");
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Buffers shrank => the source switched sessions: repaint from scratch.
    const reset = Object.entries(trail.painted).some(
      ([num, i]) => i > (source.locs[num]?.t.length ?? 0),
    );
    if (trail.key !== key || reset) {
      octx.clearRect(0, 0, w, h);
      trail.painted = {};
      trail.key = key;
    }
    octx.lineJoin = "round";
    octx.lineCap = "round";
    octx.strokeStyle = CSS("--track");
    octx.lineWidth = 9;
    for (const [num, d] of Object.entries(source.locs)) {
      const from = trail.painted[num] ?? 0;
      if (d.t.length < 2 || d.t.length - from < 1) continue;
      octx.beginPath();
      let started = false;
      for (let i = Math.max(from, 1); i < d.t.length; i++) {
        const jump =
          d.t[i] - d.t[i - 1] > JUMP_TIME ||
          Math.hypot(d.x[i] - d.x[i - 1], d.y[i] - d.y[i - 1]) > JUMP_DIST;
        if (jump) {
          started = false;
          continue;
        }
        if (!started) {
          octx.moveTo(tx(d.x[i - 1]), ty(d.y[i - 1]));
          started = true;
        }
        octx.lineTo(tx(d.x[i]), ty(d.y[i]));
      }
      octx.stroke();
      trail.painted[num] = d.t.length;
    }
    ctx.drawImage(trail.off, 0, 0, w, h);
  }

  useEffect(() => {
    const redraw = () => ref.current?.draw(lastTime.current);
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [ref]);

  return (
    <div className="track-panel">
      <canvas ref={canvasRef} />
      {overlay}
      <label className="label-toggle">
        <input
          type="checkbox"
          checked={showLabels}
          onChange={(e) => setShowLabels(e.target.checked)}
        />{" "}
        labels
      </label>
    </div>
  );
});

export default TrackCanvas;
