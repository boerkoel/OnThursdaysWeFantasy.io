import React, { useEffect, useState } from "react";
import { money } from "../lib/data.js";
import { normalCdf, normalQuantile } from "../../scripts/lib/simulation.js";

// The Primetime needle (Jim, 2026-11-02, after the NYT election needle): a matchup's win odds on a half dial,
// team a's side on the left, b's on the right, shaded from lean to very likely. The needle wanders over where
// the odds could be partway through what's left to play (Jim: drama that still means something): it averages
// out at the current odds, and how far ahead it looks follows how wild the matchup has been (Jim: a boring
// game quivers less, a wild one more) and how much is still in play (a pile of skill players left bounces it
// more than a lone kicker or D/ST). The odds under it are the steady number: they move only as plays
// and drives do (liveDrives.js), with ▲▼ for the change since the last full update. Under them the projected
// margin reads like a betting line.
const CX = 120, CY = 118, R_OUT = 104, R_IN = 66;
// Zone edges in b's win chance, and how strong each zone's shade is.
const ZONES = [[0, 5, 0.9], [5, 25, 0.6], [25, 50, 0.32], [50, 75, 0.32], [75, 95, 0.6], [95, 100, 0.9]];
const A_COLOR = "#7aa6d8", B_COLOR = "#e0a64a";
const point = (pB, r) => { const t = Math.PI * (1 - pB / 100); return [CX + r * Math.cos(t), CY - r * Math.sin(t)]; };
const wedge = (from, to) => {
  const [x1, y1] = point(from, R_OUT), [x2, y2] = point(to, R_OUT), [x3, y3] = point(to, R_IN), [x4, y4] = point(from, R_IN);
  return `M ${x1} ${y1} A ${R_OUT} ${R_OUT} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${R_IN} ${R_IN} 0 0 0 ${x4} ${y4} Z`;
};
const sdOf = d => d ? Math.max(0, (d.p75 - d.p25) / 1.349) : 0;
const half = v => (Math.round(Math.abs(v) * 2) / 2).toFixed(1);
const reducedMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

// How wild a matchup has been: its odds' average move per update over the last 15 updates (about half an
// hour), from a's side. Under 1 point is dull, 5+ is wild.
function wildness(history, teamId) {
  const ps = (history || []).map(x => Number(x.p?.[teamId])).filter(Number.isFinite).slice(-16);
  if (ps.length < 4) return 0.3;
  const moves = ps.slice(1).map((p, i) => Math.abs(p - ps[i]));
  return Math.min(1, Math.max(0, (moves.reduce((x, y) => x + y, 0) / moves.length - 1) / 4));
}

// Who finishes higher, from the two projected finals (the median race: the line falls between them): b's
// chance now, and before the drives in progress shifted the projections (liveShift).
export function higherOdds(a, b) {
  const da = a.projection?.dist, db = b.projection?.dist;
  const sd = Math.max(1, Math.hypot(sdOf(da), sdOf(db)));
  if (!da || !db) return null;
  const p = gap => Math.round(1000 * normalCdf(gap / sd)) / 10;
  return { b: p(db.mean - da.mean), bFrom: p((db.mean - (Number(b.liveShift) || 0)) - (da.mean - (Number(a.liveShift) || 0))) };
}

// Any two-way race (Jim, 2026-11-02): head to head by default (b.winProbability), or pass odds: { b, bFrom }
// (b's chance, and the same before the drives in progress moved it) and a kicker label for the ticket race or
// the median line. history: odds snapshots ({ p: { teamId: odds } }) whose moves set the wildness.
// It only moves while one of the race's starters is in a live game (Jim, 2026-11-02): between games it rests
// on the odds, so a moving needle means something is happening now. games: this week's nflGames.
const playingNow = (teams, games) => teams.some(t => (t.lineup?.starters || []).some(p =>
  games.some(g => g.state === "in" && (g.teamIds || (g.teams || []).map(x => Number(x.id))).map(Number).includes(Number(p.proTeamId)))));

export function Needle({ a, b, history = [], odds = null, label = null, games = [] }) {
  const oddsB = odds ? odds.b : Number(b.winProbability), fromB = odds ? odds.bFrom : Number(b.liveWinFrom);
  const pB = Math.min(99.9, Math.max(0.1, Number(oddsB)));
  const da = a.projection?.dist, db = b.projection?.dist;
  const sd = Math.hypot(sdOf(da), sdOf(db));
  // A fraction h through what's left, the margin has moved by Z × SD·√h and SD·√(1−h) is still to come, so the
  // odds' z is then (z + √h·Z) / √(1−h), Z standard normal (its average is still today's odds). h runs from 10%
  // for a dull matchup (a coin flip mostly sits 41–59%) to 50% for a wild one (25–75%), scaled by the stakes
  // left: the spread of the remaining margin against a full slate's (about 25 points), down to a quarter of it,
  // so a matchup down to a kicker looks barely ahead (mostly 47–53% at a coin flip). The needle walks Z as an
  // AR(1) process that stays standard normal, so over time it shows that spread of futures.
  const stakes = Math.min(1, Math.max(0.25, sd / 25));
  const h = (0.1 + 0.4 * wildness(history, a.teamId)) * stakes;
  const live = sd >= 0.5 && playingNow([a, b], games);
  const [wobble, setWobble] = useState(0);
  useEffect(() => {
    if (!live || reducedMotion()) { setWobble(0); return; }
    const RHO = 0.7, gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    let w = gauss();
    const id = setInterval(() => { w = RHO * w + Math.sqrt(1 - RHO * RHO) * gauss(); setWobble(w); }, 220);
    return () => clearInterval(id);
  }, [live]);
  if (!Number.isFinite(pB)) return null;
  const z = normalQuantile(pB / 100);
  const shown = live && wobble ? Math.min(99.5, Math.max(0.5, 100 * normalCdf((z + Math.sqrt(h) * wobble) / Math.sqrt(1 - h)))) : pB;
  // The steady odds, and how far plays have moved them since the last full update.
  const moved = Number.isFinite(Number(fromB)) ? Number(oddsB) - Number(fromB) : 0;
  const arrow = d => Math.abs(d) >= 0.5 ? <small className={d > 0 ? "up" : "down"} title="Since the last full update, from the drives in progress">{d > 0 ? "▲" : "▼"}{Math.abs(Math.round(d))}</small> : null;
  const deg = (shown / 100 - 0.5) * 180;
  const margin = da && db ? da.mean - db.mean : null;
  const lead = margin == null ? null : Math.abs(margin) < 0.25 ? "Dead even" : `${(margin > 0 ? a : b).team} by ${half(margin)}`;
  const lo = margin == null ? null : margin - 0.6745 * sd, hi = margin == null ? null : margin + 0.6745 * sd;
  // The middle half of outcomes, from the projected winner's side: "likely 3.5–17.5", or "either way" if it spans both.
  const sign = margin >= 0 ? 1 : -1;
  const range = lo == null ? null : lo * hi <= 0 ? "either way" : `likely ${half(Math.min(sign * lo, sign * hi))}–${half(Math.max(sign * lo, sign * hi))}`;
  return (
    <div className="needle" role="img" title={live ? "Live: the needle wanders over where the odds could be partway through what's left to play, averaging out at the current odds" : "The needle moves while their players are in a game"} aria-label={`${label ? label + ": " : ""}${a.team} ${Math.round(100 - pB)}%, ${b.team} ${Math.round(pB)}%`}>
      {label || live ? <small className="needle-label">{label}{live ? <span className="needle-live">● LIVE</span> : null}</small> : null}
      <svg viewBox="0 0 240 128" className="needle-dial">
        {ZONES.map(([from, to, o]) => <path key={from} d={wedge(from, to)} fill={to <= 50 ? A_COLOR : B_COLOR} fillOpacity={o} />)}
        <line x1={CX} y1={CY - R_OUT - 3} x2={CX} y2={CY - R_IN + 3} className="needle-mid" />
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: "transform .22s linear" }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R_OUT - 4} className="needle-hand" />
        </g>
        <circle cx={CX} cy={CY} r={5} className="needle-hub" />
      </svg>
      <div className="needle-odds">
        <span style={{ color: A_COLOR }}><b>{Math.round(100 - pB)}%{arrow(-moved)}</b>{a.team}</span>
        <span style={{ color: B_COLOR }}><b>{Math.round(pB)}%{arrow(moved)}</b>{b.team}</span>
      </div>
      {lead ? <p className="needle-line" title={`Projected ${money(da.mean)} – ${money(db.mean)}; middle half of outcomes: ${a.team} ${lo >= 0 ? "+" : "−"}${half(lo)} to ${hi >= 0 ? "+" : "−"}${half(hi)}`}>
        Projected: <b>{lead}</b> ({range})</p> : null}
    </div>
  );
}
