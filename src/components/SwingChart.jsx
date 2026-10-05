import React, { useState } from "react";
import PlayMarkers, { playTime } from "./PlayMarkers.jsx";
import { pct } from "../lib/data.js";

// Win-odds swing chart for one matchup: team A's chance of winning over the
// week (team B's is the mirror image). One series, so the caption names it
// instead of a legend; the dashed line marks 50%. Hover (or touch) shows the
// odds at that moment. A 🏈 marks each play that moved the odds 3%+; hover
// (or tap) it to see the play. Plays too close together to tell apart share
// one marker.
const WIDTH = 300;
const HEIGHT = 56;
const PAD = 5;

// The recap's tipping point for a finished matchup: the play that put the
// winner ahead in the odds for good (the last time their line crossed 50%),
// or, if they were favored all week, the biggest swing their way.
export function tippingPoint(points, winnerId, winnerName, plays = []) {
  const series = (points || []).map(pt => ({ t: Date.parse(pt.t), p: Number(pt.p?.[winnerId]) })).filter(pt => Number.isFinite(pt.t) && Number.isFinite(pt.p));
  if (series.length < 2) return null;
  const theirs = plays.filter(p => Number(p.momentum?.towardTeamId) === Number(winnerId) && p.wallclock);
  const biggest = [...theirs].sort((a, b) => b.momentum.shift - a.momentum.shift)[0];
  let cross = -1;
  for (let i = 1; i < series.length; i++) if (series[i - 1].p < 50 && series[i].p >= 50) cross = i;
  const describe = p => `${p.player} (${p.points > 0 ? "+" : ""}${Number(p.points).toFixed(2)}${p.period ? ", " + playTime(p) : ""})`;
  if (cross < 0) {
    return biggest ? `Wire to wire: ${winnerName} was favored all week. Biggest swing: ${describe(biggest)} moved it ${pct(biggest.momentum.shift)} their way.` : null;
  }
  const t = series[cross].t;
  const play = theirs.filter(p => Date.parse(p.wallclock) <= t + 5 * 60 * 1000).sort((a, b) => Date.parse(b.wallclock) - Date.parse(a.wallclock))[0] || biggest;
  return play ? `${describe(play)} put ${winnerName} ahead in the odds for good, a ${pct(play.momentum.shift)} swing.` : null;
}

export default function SwingChart({ points, teamId, teamName, opponentName, plays = [], crossings = false }) {
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
        {crossings ? series.slice(1).map((pt, i) => {
          // 💥 wherever the line crosses 50%: the other team took over.
          const prev = series[i];
          if (!((prev.p < 50 && pt.p > 50) || (prev.p > 50 && pt.p < 50))) return null;
          const t = prev.t + (50 - prev.p) / (pt.p - prev.p) * (pt.t - prev.t);
          const who = pt.p > 50 ? teamName : opponentName;
          return <span key={"bang-" + i} className="swing-bang" style={{ left: `${(x({ t }) / WIDTH) * 100}%`, top: "50%" }}
            title={`${who} took over (${new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })})`}>💥</span>;
        }) : null}
        <PlayMarkers plays={plays} t0={t0} end={last.t} width={WIDTH} height={HEIGHT}
          x={t => x({ t })} y={p => y({ p })} valueAt={(play, t) => (series.find(pt => pt.t >= t) || last).p}
          swingText={play => `${pct(play.momentum.shift)} toward ${play.momentum.toward} (now ${pct(play.momentum.winProbability)})`} />
      </div>
    </div>
  );
}
