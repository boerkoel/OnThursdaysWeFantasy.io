import React, { useState } from "react";
import { money } from "../lib/data.js";

// 🏈 markers on an odds chart (matchup win odds, Death Watch chop odds,
// ticket odds): each play sits on its line at the odds just after it
// happened; hover (or tap) for the play. Plays too close together to tell
// apart share one marker, biggest swing first.
// x(t), y(value): chart coordinates; valueAt(play, t): the line's value;
// swingText(play): the "⚡" line; ringColor(play), subtitle(play): optional.
const CLUSTER_X = 14;

export const playTime = play => play.period
  ? `Q${play.period > 4 ? "OT" : play.period} ${play.clock || ""}`.trim()
  : new Date(play.wallclock).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export default function PlayMarkers({ plays, t0, end, x, y, valueAt, width, height, swingText, ringColor, subtitle }) {
  const [active, setActive] = useState(null);
  const magnitude = p => Math.abs(p.momentum?.shift || 0);
  const clampT = play => Math.min(end, Math.max(t0, Date.parse(play.wallclock)));
  const markers = [];
  for (const play of plays.filter(p => p.wallclock).sort((a, b) => Date.parse(a.wallclock) - Date.parse(b.wallclock))) {
    const px = x(clampT(play));
    const group = markers[markers.length - 1];
    if (group && px - group.firstX <= CLUSTER_X) group.plays.push(play);
    else markers.push({ firstX: px, plays: [play] });
  }
  for (const m of markers) {
    m.plays.sort((a, b) => magnitude(b) - magnitude(a));
    m.t = clampT(m.plays[0]);
    m.p = valueAt(m.plays[0], m.t);
  }
  const current = active != null ? markers[active] : null;
  return <>
    {markers.map((m, i) => (
      <button type="button" key={m.plays[0].id} className={"swing-play-marker" + (i === active ? " active" : "")}
        style={{ left: `${(x(m.t) / width) * 100}%`, top: `${(y(m.p) / height) * 100}%`, ...(ringColor ? { boxShadow: `0 0 0 1px ${ringColor(m.plays[0])}` } : {}) }}
        aria-label={`Key play: ${m.plays[0].player}, ${swingText(m.plays[0])}`}
        onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}
        onClick={event => { event.stopPropagation(); setActive(i === active ? null : i); }}>🏈</button>
    ))}
    {current ? (
      <div className="swing-play-tip" style={{ left: `${Math.min(80, Math.max(20, (x(current.t) / width) * 100))}%` }} role="tooltip">
        {current.plays.slice(0, 3).map(play => (
          <div key={play.id} className="swing-play-tip-row">
            <div><b className={play.points < 0 ? "negative" : ""}>{play.points > 0 ? "+" : ""}{money(play.points)}</b> {play.player} <small>{subtitle ? subtitle(play) + " · " : ""}{playTime(play)}</small></div>
            <p>{play.text}</p>
            <em>⚡ {swingText(play)}</em>
          </div>
        ))}
        {current.plays.length > 3 ? <small className="swing-play-more">+{current.plays.length - 3} more</small> : null}
      </div>
    ) : null}
  </>;
}
