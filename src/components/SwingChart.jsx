import React, { useState } from "react";

// Win-odds swing chart for one matchup: team A's chance of winning over the
// week (team B's is the mirror image). One series, so the caption names it
// instead of a legend; the dashed line marks 50%. Hover (or touch) shows the
// odds at that moment. A 🏈 marks each play that moved the odds 3%+; hover
// (or tap) it to see the play. Plays too close together to tell apart share
// one marker.
const WIDTH = 300;
const HEIGHT = 56;
const PAD = 5;
const CLUSTER_X = 14;

export default function SwingChart({ points, teamId, teamName, opponentName, plays = [] }) {
  const [hover, setHover] = useState(null);
  const [activeMarker, setActiveMarker] = useState(null);
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

  // Each play sits on the line at the odds just after it happened.
  const end = series[series.length - 1].t;
  const markers = [];
  for (const play of [...plays].filter(p => p.wallclock).sort((a, b) => Date.parse(a.wallclock) - Date.parse(b.wallclock))) {
    const t = Math.min(end, Math.max(t0, Date.parse(play.wallclock)));
    const after = series.find(pt => pt.t >= t) || last;
    const px = x({ t });
    const group = markers[markers.length - 1];
    if (group && px - group.firstX <= CLUSTER_X) group.plays.push(play);
    else markers.push({ firstX: px, plays: [play], t, p: after.p });
  }
  for (const m of markers) {
    m.plays.sort((a, b) => b.momentum.shift - a.momentum.shift);
    const lead = m.plays[0];
    m.t = Math.min(end, Math.max(t0, Date.parse(lead.wallclock)));
    m.p = (series.find(pt => pt.t >= m.t) || last).p;
  }
  const active = activeMarker != null ? markers[activeMarker] : null;
  const playTime = play => play.period ? `Q${play.period > 4 ? "OT" : play.period} ${play.clock || ""}`.trim() : new Date(play.wallclock).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

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
        {markers.map((m, i) => (
          <button type="button" key={m.plays[0].id} className={"swing-play-marker" + (i === activeMarker ? " active" : "")}
            style={{ left: `${(x(m) / WIDTH) * 100}%`, top: `${(y(m) / HEIGHT) * 100}%` }}
            aria-label={`Key play: ${m.plays[0].player}, odds swung ${m.plays[0].momentum.shift.toFixed(1)}%`}
            onMouseEnter={() => setActiveMarker(i)} onMouseLeave={() => setActiveMarker(null)}
            onClick={event => { event.stopPropagation(); setActiveMarker(i === activeMarker ? null : i); }}>🏈</button>
        ))}
        {active ? (
          <div className="swing-play-tip" style={{ left: `${Math.min(80, Math.max(20, (x(active) / WIDTH) * 100))}%` }} role="tooltip">
            {active.plays.slice(0, 3).map(play => (
              <div key={play.id} className="swing-play-tip-row">
                <div><b className={play.points < 0 ? "negative" : ""}>{play.points > 0 ? "+" : ""}{Number(play.points).toFixed(2)}</b> {play.player} <small>{playTime(play)}</small></div>
                <p>{play.text}</p>
                <em>⚡ {play.momentum.shift.toFixed(1)}% toward {play.momentum.toward} (now {play.momentum.winProbability.toFixed(1)}%)</em>
              </div>
            ))}
            {active.plays.length > 3 ? <small className="swing-play-more">+{active.plays.length - 3} more</small> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
