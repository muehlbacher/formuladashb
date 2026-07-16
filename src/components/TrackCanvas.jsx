import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

const CSS = (v) =>
  getComputedStyle(document.documentElement).getPropertyValue(v).trim();

// Imperative canvas: App's animation loop calls ref.draw(time) every frame,
// so car movement never goes through React state.
const TrackCanvas = forwardRef(function TrackCanvas({ race }, ref) {
  const canvasRef = useRef(null);
  const [showLabels, setShowLabels] = useState(true);
  const showLabelsRef = useRef(true);
  showLabelsRef.current = showLabels;
  const lastTime = useRef(0);

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

      // Fit world coords into the canvas, y flipped so north stays up.
      const { bounds, track, meta, carPos } = race;
      const pad = Math.min(34, Math.min(w, h) * 0.08);
      const worldW = bounds.maxX - bounds.minX,
        worldH = bounds.maxY - bounds.minY;
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

        const sf = track.startFinish,
          L = 11;
        ctx.beginPath();
        ctx.moveTo(tx(sf.x) - sf.nx * L, ty(sf.y) + sf.ny * L);
        ctx.lineTo(tx(sf.x) + sf.nx * L, ty(sf.y) - sf.ny * L);
        ctx.strokeStyle = "#dfe3ea";
        ctx.lineWidth = 3;
        ctx.stroke();
      }

      ctx.font = "600 10px -apple-system, 'Segoe UI', sans-serif";
      ctx.textBaseline = "middle";
      for (const d of meta.drivers) {
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

  useEffect(() => {
    const redraw = () => ref.current?.draw(lastTime.current);
    window.addEventListener("resize", redraw);
    return () => window.removeEventListener("resize", redraw);
  }, [ref]);

  return (
    <div className="track-panel">
      <canvas ref={canvasRef} />
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
