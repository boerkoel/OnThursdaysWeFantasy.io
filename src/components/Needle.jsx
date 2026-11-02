import React, { useEffect, useId, useState } from "react";
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

// While games are on (Jim, 2026-11-02): where the odds stood when the race's first game in progress kicked off,
// from the history (b's chance: head to head, or two-way shares for the ticket and chop races).
function kickoffOdds({ a, b, history, games, twoWay }) {
  const ids = new Set([a, b].flatMap(t => (t.lineup?.starters || []).map(p => Number(p.proTeamId))));
  const kicks = games.filter(g => g.state === "in" && (g.teamIds || []).some(id => ids.has(Number(id)))).map(g => Date.parse(g.kickoff)).filter(Number.isFinite);
  if (!kicks.length || !history?.length) return null;
  const before = history.filter(x => Date.parse(x.t) <= Math.min(...kicks) + 60000).at(-1);
  const pa = Number(before?.p?.[a.teamId]), pb = Number(before?.p?.[b.teamId]);
  if (!Number.isFinite(pb)) return null;
  return twoWay ? (Number.isFinite(pa) && pa + pb > 0 ? 100 * pb / (pa + pb) : null) : pb;
}
// The race's players in games being played now, each trending up (↑, 2+ pts ahead of his projected pace),
// down (↓, 2+ behind) or on pace (→).
function onTheField(team, games) {
  return (team.lineup?.starters || []).flatMap(p => {
    const g = games.find(x => x.state === "in" && (x.teamIds || []).map(Number).includes(Number(p.proTeamId)));
    if (!g) return [];
    const left = g.period > 4 ? 0 : Math.max(0, (4 - (Number(g.period) || 1)) * 900 + (Number(g.clock) || 0));
    const due = (Number(p.projection) || 0) * (1 - left / 3600), diff = (Number(p.actual) || 0) - due;
    const name = /D\/ST/.test(p.name) ? p.name.replace(" D/ST", "") : p.name.replace(/^[A-Z]\.\s*/, "");
    return [{ name, trend: diff >= 2 ? "up" : diff <= -2 ? "down" : "even", title: `${p.name}: ${money(p.actual)} pts, ${money(due)} expected by now` }];
  });
}

// The needle's motion, shared by the full and mini needles (see the comment in Needle): which look-ahead h,
// and the walk; returns whether it's live and where the needle sits now.
function lookAhead(stakes, wild) {
  const live = stakes.live >= 0.25;
  const size = Math.min(1, Math.max(0.25, Math.sqrt(stakes.live) / 20));
  return { live, h: live ? Math.min(0.5, (stakes.live / stakes.total) * size * (0.6 + 0.8 * wild)) : stakes.total >= 0.25 ? 0.02 : 0 };
}
function useQuake({ teams, games, history, historyId, p }) {
  const { live, h } = lookAhead(stakesLeft(teams, games), wildness(history, historyId));
  const [wobble, setWobble] = useState(0);
  useEffect(() => {
    if (!(h > 0) || reducedMotion()) { setWobble(0); return; }
    const RHO = live ? 0.7 : 0.85, gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    let w = gauss();
    const id = setInterval(() => { w = RHO * w + Math.sqrt(1 - RHO * RHO) * gauss(); setWobble(w); }, live ? 220 : 650);
    return () => clearInterval(id);
  }, [live, h > 0]);
  const pp = Math.min(99.9, Math.max(0.1, Number(p)));
  const shown = h > 0 && wobble && Number.isFinite(pp) ? Math.min(99.5, Math.max(0.5, 100 * normalCdf((normalQuantile(pp / 100) + Math.sqrt(h) * wobble) / Math.sqrt(1 - h)))) : pp;
  return { live, shown };
}

// One team's own needle (Jim, 2026-11-02: everyone within reach of the median line, every team in danger of the
// chop): its chance of the named outcome, on a small dial, moving by the same rules as the full needle.
// p: the chance of the right side's outcome; from: the same before the drives in progress moved it.
// sides: [left label, right label], colors: [left, right]. caption: the line under it (the team's name by
// default); stakes: the teams whose players can move it (the team itself, or both sides of a matchup).
export function MiniNeedle({ team, p, from = null, sides, colors, history = [], games = [], mine = false, caption = null, stakes = null }) {
  const { live, shown } = useQuake({ teams: stakes || [team], games, history, historyId: team.teamId, p });
  if (!Number.isFinite(Number(p))) return null;
  const right = Number(p) >= 50;
  // The drives' move in the number shown (the side it favors).
  const moved = from != null && Number.isFinite(Number(from)) ? (Number(p) - Number(from)) * (right ? 1 : -1) : 0;
  const deg = (shown / 100 - 0.5) * 180;
  return (
    <div className={"mini-needle" + (mine ? " mine" : "")} role="img" aria-label={`${team.team}: ${Math.round(p)}% ${sides[1]}`}
      title={`${team.team}: ${Math.round(p)}% ${sides[1]}, ${Math.round(100 - p)}% ${sides[0]}${live ? " · live" : ""}`}>
      <svg viewBox="0 0 240 128" className="needle-dial">
        {ZONES.map(([lo, hi, o]) => <path key={lo} d={wedge(lo, hi)} fill={hi <= 50 ? colors[0] : colors[1]} fillOpacity={o} />)}
        <line x1={CX} y1={CY - R_OUT - 3} x2={CX} y2={CY - R_IN + 3} className="needle-mid" />
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: `transform ${live ? 0.22 : 0.65}s linear` }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R_OUT - 4} className="needle-hand" />
        </g>
        <circle cx={CX} cy={CY} r={7} className="needle-hub" />
      </svg>
      <b style={{ color: right ? colors[1] : colors[0] }}>{Math.round(right ? p : 100 - p)}% {right ? sides[1] : sides[0]}
        {Math.abs(moved) >= 0.5 ? <small className={moved > 0 ? "up" : "down"}>{moved > 0 ? "▲" : "▼"}{Math.abs(Math.round(moved))}</small> : null}
        {live ? <span className="needle-live">●</span> : null}</b>
      <span className="mini-needle-name">{caption || team.team}</span>
    </div>
  );
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
  const { live, shown } = useQuake({ teams: [a, b], games, history, historyId: a.teamId, p: pB });
  const arcId = useId();
  if (!Number.isFinite(pB)) return null;
  // The steady odds, and how far plays have moved them since the last full update.
  const moved = Number.isFinite(Number(fromB)) ? Number(oddsB) - Number(fromB) : 0;
  const arrow = d => Math.abs(d) >= 0.5 ? <small className={d > 0 ? "up" : "down"} title="Since the last full update, from the drives in progress">{d > 0 ? "▲" : "▼"}{Math.abs(Math.round(d))}</small> : null;
  const deg = (shown / 100 - 0.5) * 180;
  // Drift since kickoff: an arc outside the dial from the odds then to now, and the points it's moved.
  const startB = live ? kickoffOdds({ a, b, history, games, twoWay: Boolean(odds) }) : null;
  const drift = startB == null ? 0 : pB - startB;
  const R_ARC = R_OUT + 8;
  const arc = Math.abs(drift) >= 1 ? (() => {
    const [x1, y1] = point(startB, R_ARC), [x2, y2] = point(pB, R_ARC);
    return `M ${x1} ${y1} A ${R_ARC} ${R_ARC} 0 0 ${drift > 0 ? 1 : 0} ${x2} ${y2}`;
  })() : null;
  const field = live ? [onTheField(a, games), onTheField(b, games)] : null;
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
        {arc ? <>
          <defs><marker id={arcId} viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 Z" className="needle-drift-head" /></marker></defs>
          <path d={arc} className="needle-drift" markerEnd={`url(#${arcId})`} />
          <circle cx={point(startB, R_ARC)[0]} cy={point(startB, R_ARC)[1]} r={2} className="needle-drift-start" />
        </> : null}
      </svg>
      {Math.abs(drift) >= 1 ? <p className="needle-drift-text" title={`${b.team} ${Math.round(startB)}% when the game${games.filter(g => g.state === "in").length > 1 ? "s" : ""} kicked off, ${Math.round(pB)}% now`}>
        since kickoff {drift < 0 ? <b style={{ color: A_COLOR }}>◀ {Math.round(-drift)}</b> : <b style={{ color: B_COLOR }}>{Math.round(drift)} ▶</b>}</p> : null}
      <div className="needle-odds">
        <span style={{ color: A_COLOR }}><b>{Math.round(100 - pB)}%{arrow(-moved)}</b>{a.team}</span>
        <span style={{ color: B_COLOR }}><b>{Math.round(pB)}%{arrow(moved)}</b>{b.team}</span>
      </div>
      {field && (field[0].length || field[1].length) ? <div className="needle-field">
        {field.map((list, i) => <span key={i}>{list.map(p => <em key={p.name} className={p.trend} title={p.title}>{p.name} {p.trend === "up" ? "↑" : p.trend === "down" ? "↓" : "→"}</em>)}</span>)}
      </div> : null}
      {lead ? <p className="needle-line" title={`Projected ${money(da.mean)} – ${money(db.mean)}; middle half of outcomes: ${a.team} ${lo >= 0 ? "+" : "−"}${half(lo)} to ${hi >= 0 ? "+" : "−"}${half(hi)}`}>
        Projected: <b>{lead}</b> ({range})</p> : null}
    </div>
  );
}
