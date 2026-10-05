import React, { useState } from "react";
import { money, pct } from "../lib/data.js";
import PlayMarkers from "./PlayMarkers.jsx";

// Odds race panel (Death Watch chop odds, ticket race odds): the odds of the
// three teams on the podium over the week,
// one line each, with a 🏈 on each play that moved a team's chop odds 3%+
// (hover or tap for the play), and those teams' key plays underneath: the
// 5 most recent, topped up with the week's biggest swings (up to 10).
const WIDTH = 300;
const HEIGHT = 90;
const PAD = 6;
const BIG_SWING = 3;
const KEY_POINTS = 4;
const KEY_PLAYS_RECENT = 5;
const KEY_PLAYS_MAX = 10;
const KEY_PLAY_MAX_AGE_MS = 5 * 60 * 60 * 1000;
export const CHOP_COLORS = ["#ef9a96", "#e6c85c", "#9cc3e6"];

const newestFirst = (a, b) => Date.parse(b.wallclock) - Date.parse(a.wallclock);
const chopSwingText = play => play.momentum
  ? `chop odds ${play.momentum.shift > 0 ? "down" : "up"} ${pct(Math.abs(play.momentum.shift))} (now ${pct(play.momentum.chopProbability)})`
  : null;

// The teams whose story the chart tells: the n with the highest odds at any
// point this week (history plus now), so a team that escaped (or locked it
// up) stays on the chart with the plays that did it.
export function peakTeams(history, teams, n = 3) {
  const peak = new Map(teams.map(t => [String(t.teamId), Number(t.value) || 0]));
  for (const pt of history || []) for (const [id, v] of Object.entries(pt.p || {})) {
    if (peak.has(id) && Number(v) > peak.get(id)) peak.set(id, Number(v));
  }
  return [...teams].sort((a, b) => peak.get(String(b.teamId)) - peak.get(String(a.teamId))).filter(t => peak.get(String(t.teamId)) > 0).slice(0, n);
}

export function keyChopPlays(plays) {
  const recent = plays.filter(p => p.wallclock && (Math.abs(p.points) >= KEY_POINTS || Math.abs(p.momentum?.shift || 0) >= BIG_SWING) && Date.now() - Date.parse(p.wallclock) <= KEY_PLAY_MAX_AGE_MS)
    .sort(newestFirst).slice(0, KEY_PLAYS_RECENT);
  const chosen = new Map(recent.map(p => [p.id, p]));
  for (const p of plays.filter(p => p.wallclock && Math.abs(p.momentum?.shift || 0) >= BIG_SWING).sort((a, b) => Math.abs(b.momentum.shift) - Math.abs(a.momentum.shift))) {
    if (chosen.size >= KEY_PLAYS_MAX) break;
    chosen.set(p.id, p);
  }
  return [...chosen.values()].sort(newestFirst);
}

export default function ChopChart({ history, teams, plays, colors = CHOP_COLORS, title = "CHOP ODDS · MOST AT RISK", swingText = chopSwingText, ariaLabel = "Chop odds over the week for the most at-risk teams" }) {
  const [hover, setHover] = useState(null);
  const points = (history || []).map(pt => ({ t: Date.parse(pt.t), p: pt.p || {} })).filter(pt => Number.isFinite(pt.t));
  const ids = teams.map(t => String(t.teamId));
  const colorOf = Object.fromEntries(ids.map((id, i) => [id, colors[i]]));
  const nameOf = Object.fromEntries(teams.map(t => [String(t.teamId), t.team]));
  const keyPlays = keyChopPlays(plays);
  const enoughHistory = points.length >= 2;

  let chart = null;
  if (enoughHistory) {
    const t0 = points[0].t, end = points[points.length - 1].t, span = Math.max(1, end - t0);
    const top = Math.max(20, Math.ceil(Math.max(...points.flatMap(pt => ids.map(id => Number(pt.p[id]) || 0))) / 10) * 10);
    const x = t => PAD + ((t - t0) / span) * (WIDTH - 2 * PAD);
    const y = p => PAD + (1 - p / top) * (HEIGHT - 2 * PAD);
    const valueAt = (id, t) => Number((points.find(pt => pt.t >= t) || points[points.length - 1]).p[id]);
    const paths = ids.map(id => points.filter(pt => Number.isFinite(Number(pt.p[id])))
      .map((pt, i) => `${i ? "L" : "M"}${x(pt.t).toFixed(1)},${y(Number(pt.p[id])).toFixed(1)}`).join(" "));

    const shown = hover ?? points[points.length - 1];
    const onMove = event => {
      const box = event.currentTarget.getBoundingClientRect();
      const clientX = event.touches ? event.touches[0].clientX : event.clientX;
      const target = t0 + ((clientX - box.left) / box.width * WIDTH - PAD) / (WIDTH - 2 * PAD) * span;
      setHover(points.reduce((a, b) => (Math.abs(b.t - target) < Math.abs(a.t - target) ? b : a)));
    };
    const when = hover ? new Date(shown.t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "now";

    chart = <>
      <div className="chop-legend">
        {ids.map(id => <div key={id}><i style={{ background: colorOf[id] }}></i>{nameOf[id]} <b>{Number.isFinite(Number(shown.p[id])) ? pct(shown.p[id]) : "—"}</b></div>)}
        <em>{when}</em>
      </div>
      <div className="swing-plot chop-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)} onTouchStart={onMove} onTouchMove={onMove} onTouchEnd={() => setHover(null)}>
          {[0.25, 0.5, 0.75].map(f => <line key={f} className="swing-midline" x1={PAD} x2={WIDTH - PAD} y1={y(top * f)} y2={y(top * f)} />)}
          {paths.map((d, i) => <path key={ids[i]} d={d} fill="none" stroke={colorOf[ids[i]]} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />)}
          {hover ? <line className="swing-crosshair" x1={x(hover.t)} x2={x(hover.t)} y1={PAD} y2={HEIGHT - PAD} vectorEffect="non-scaling-stroke" /> : null}
        </svg>
        <i className="chop-axis top">{top}%</i><i className="chop-axis bottom">0%</i>
        <PlayMarkers plays={plays.filter(p => Math.abs(p.momentum?.shift || 0) >= BIG_SWING)} t0={t0} end={end} width={WIDTH} height={HEIGHT}
          x={x} y={y} valueAt={(play, t) => valueAt(String(play.teamId), t)} swingText={swingText}
          ringColor={play => colorOf[String(play.teamId)]} subtitle={play => nameOf[String(play.teamId)]} />
      </div>
    </>;
  }

  return <div className="chop-panel">
    <div className="key-plays-heading"><span>{title}</span><em>{enoughHistory ? "HOVER THE LINES OR 🏈" : "CHART STARTS WITH THE NEXT UPDATES"}</em></div>
    {chart}
    {keyPlays.length ? <div className="key-plays">
      <div className="key-plays-heading"><span>KEY PLAYS</span><em>LATEST + BIGGEST SWINGS</em></div>
      <div className="key-play-list">
        {keyPlays.map(play => <div className="key-play" key={play.id}>
          <strong className={play.points < 0 ? "negative" : ""}>{play.points > 0 ? "+" : ""}{money(play.points)}</strong>
          <span><b>{play.player}</b> <i className="chop-team-dot" style={{ background: colorOf[String(play.teamId)] }}></i>{nameOf[String(play.teamId)]} · {play.text}
            {swingText(play) ? <em className="key-play-momentum">⚡ {swingText(play)}</em> : null}</span>
        </div>)}
      </div>
    </div> : null}
  </div>;
}
