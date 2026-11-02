import React, { useEffect, useState } from "react";
import { money } from "../lib/data.js";
import { normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";

// The Primetime needle (Jim, 2026-11-02, after the NYT election needle): a matchup's win odds on a half dial,
// team a's side on the left, b's on the right, shaded from lean to very likely. The needle wanders over where
// the odds could be once the games in progress are over (Jim: drama that still means something, in proportion
// to what those games can change): it averages out at the current odds, swings as far as those games can move
// them, more for a wild matchup and less for a dull one, and between games only quakes, muted. The odds under it are the steady number: they move only as plays
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
// games: this week's nflGames. How much of the race is still to be decided, as variance in points: all of both
// teams' unfinished starters, and those in the games being played right now.
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, "D/ST": 16 };
function stakesLeft(teams, games) {
  let total = 0, live = 0;
  for (const p of teams.flatMap(t => t.lineup?.starters || [])) {
    const game = games.find(g => (g.teamIds || (g.teams || []).map(x => Number(x.id))).map(Number).includes(Number(p.proTeamId)));
    if (!game || game.completed) continue;
    const v = playerOutlook({ actual: p.actual, projection: p.projection, positionId: POSITION_IDS[p.pos], game, proTeamId: p.proTeamId }).sd ** 2;
    total += v;
    if (game.state === "in") live += v;
  }
  return { total, live };
}

export function Needle({ a, b, history = [], odds = null, label = null, games = [] }) {
  const oddsB = odds ? odds.b : Number(b.winProbability), fromB = odds ? odds.bFrom : Number(b.liveWinFrom);
  const pB = Math.min(99.9, Math.max(0.1, Number(oddsB)));
  const da = a.projection?.dist, db = b.projection?.dist;
  const sd = Math.hypot(sdOf(da), sdOf(db));
  // Once a fraction h of what's left has played out, the margin has moved by Z × SD·√h and SD·√(1−h) is still
  // to come, so the odds' z is then (z + √h·Z) / √(1−h), Z standard normal (its average is still today's odds).
  // Live, h is the share of what's left that the games in progress decide (their starters' variance over all
  // unfinished starters'), times how much those games hold in points (their spread against a big game's ~20,
  // down to a quarter: a lone kicker or D/ST barely moves it, a pile of skill players does), times 0.6 for a
  // dull matchup up to 1.4 for a wild one, at most 50%: a game holding several of both teams' last skill players
  // sweeps a coin flip about 25–75%; one RB, about 40–60%.
  // Between games it's a muted quake (h 2%, slower: a coin flip drifts 46–54%), none once nothing is left.
  // The needle walks Z as an AR(1) process that stays standard normal, so over time it shows that spread.
  const stakes = stakesLeft([a, b], games);
  const live = stakes.live >= 0.25;
  const size = Math.min(1, Math.max(0.25, Math.sqrt(stakes.live) / 20));
  const h = live ? Math.min(0.5, (stakes.live / stakes.total) * size * (0.6 + 0.8 * wildness(history, a.teamId))) : stakes.total >= 0.25 ? 0.02 : 0;
  const [wobble, setWobble] = useState(0);
  useEffect(() => {
    if (!(h > 0) || reducedMotion()) { setWobble(0); return; }
    const RHO = live ? 0.7 : 0.85, gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    let w = gauss();
    const id = setInterval(() => { w = RHO * w + Math.sqrt(1 - RHO * RHO) * gauss(); setWobble(w); }, live ? 220 : 650);
    return () => clearInterval(id);
  }, [live, h > 0]);
  if (!Number.isFinite(pB)) return null;
  const z = normalQuantile(pB / 100);
  const shown = h > 0 && wobble ? Math.min(99.5, Math.max(0.5, 100 * normalCdf((z + Math.sqrt(h) * wobble) / Math.sqrt(1 - h)))) : pB;
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
    <div className="needle" role="img" title={live ? "Live: the needle wanders over where the odds could be once the games in progress are over, averaging out at the current odds" : "Between games the needle only quakes; it swings while their players are in a game"} aria-label={`${label ? label + ": " : ""}${a.team} ${Math.round(100 - pB)}%, ${b.team} ${Math.round(pB)}%`}>
      {label || live ? <small className="needle-label">{label}{live ? <span className="needle-live">● LIVE</span> : null}</small> : null}
      <svg viewBox="0 0 240 128" className="needle-dial">
        {ZONES.map(([from, to, o]) => <path key={from} d={wedge(from, to)} fill={to <= 50 ? A_COLOR : B_COLOR} fillOpacity={o} />)}
        <line x1={CX} y1={CY - R_OUT - 3} x2={CX} y2={CY - R_IN + 3} className="needle-mid" />
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: `transform ${live ? 0.22 : 0.65}s linear` }}>
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
