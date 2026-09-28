import React, { useState } from "react";

// Win-odds swing chart for one matchup: team A's chance of winning over the
// week (team B's is the mirror image). One series, so the caption names it
// instead of a legend; the dashed line marks 50%. Hover (or touch) shows the
// odds at that moment.
const WIDTH = 300;
const HEIGHT = 56;
const PAD = 5;

export default function SwingChart({ points, teamId, teamName, opponentName }) {
  const [hover, setHover] = useState(null);
  const series = (points || [])
    .map(pt => ({ t: Date.parse(pt.t), p: Number(pt.p?.[teamId]) }))
    .filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p));
  if (series.length < 2) return null;

  const t0 = series[0].t;
  const span = Math.max(1, series[series.length - 1].t - t0);
  const x = pt => PAD + ((pt.t - t0) / span) * (WIDTH - 2 * PAD);
  const y = pt => PAD + (1 - pt.p / 100) * (HEIGHT - 2 * PAD);
  const path = series.map((pt, i) => `${i ? "L" : "M"}${x(pt).toFixed(1)},${y(pt).toFixed(1)}`).join(" ");
  const last = series[series.length - 1];
  const low = series.reduce((a, b) => (b.p < a.p ? b : a));
  const high = series.reduce((a, b) => (b.p > a.p ? b : a));
  const shown = hover ?? last;

  const onMove = event => {
    const box = event.currentTarget.getBoundingClientRect();
    const clientX = event.touches ? event.touches[0].clientX : event.clientX;
    const target = t0 + ((clientX - box.left) / box.width * WIDTH - PAD) / (WIDTH - 2 * PAD) * span;
    setHover(series.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a)));
  };
  const when = new Date(shown.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

  return (
    <div className="swing-chart">
      <div className="swing-caption">
        <span>WIN ODDS · {teamName}</span>
        <span><b>{Math.round(shown.p)}%</b> {hover ? when : "now"} · range {Math.round(low.p)}–{Math.round(high.p)}%</span>
      </div>
      <div className="swing-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img"
          aria-label={`${teamName}'s win odds against ${opponentName} moved between ${Math.round(low.p)}% and ${Math.round(high.p)}% and are ${Math.round(last.p)}% now`}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}>
          <line className="swing-midline" x1={PAD} x2={WIDTH - PAD} y1={HEIGHT / 2} y2={HEIGHT / 2} />
          <path className="swing-line" d={path} vectorEffect="non-scaling-stroke" />
          {hover ? <line className="swing-crosshair" x1={x(hover)} x2={x(hover)} y1={PAD} y2={HEIGHT - PAD} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        {/* Marker outside the stretched SVG so it stays round. */}
        <span className="swing-dot" style={{ left: `${(x(shown) / WIDTH) * 100}%`, top: `${(y(shown) / HEIGHT) * 100}%` }} />
      </div>
    </div>
  );
}
