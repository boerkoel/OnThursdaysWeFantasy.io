import React, { useEffect, useId, useRef, useState } from "react";
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
// at: a start time of its own instead (the day's first kickoff, for the arcs).
function kickoffOdds({ a, b, history, games, twoWay, at = null }) {
  const ids = new Set([a, b].flatMap(t => (t.lineup?.starters || []).map(p => Number(p.proTeamId))));
  const kicks = at != null ? [at] : games.filter(g => g.state === "in" && (g.teamIds || []).some(id => ids.has(Number(id)))).map(g => Date.parse(g.kickoff)).filter(Number.isFinite);
  if (!kicks.length || !history?.length) return null;
  const before = history.filter(x => Date.parse(x.t) <= Math.min(...kicks) + 60000).at(-1);
  const pa = Number(before?.p?.[a.teamId]), pb = Number(before?.p?.[b.teamId]);
  if (!Number.isFinite(pb)) return null;
  return twoWay ? (Number.isFinite(pa) && pa + pb > 0 ? 100 * pb / (pa + pb) : null) : pb;
}
// Since the first game in progress among these teams' players kicked off (Jim, 2026-11-02): where this odds
// series started, and the lowest and highest it has been since, now included, for the drift arrow and the
// band behind it that shows a swing that came back. history: snapshots { t, p: { [id]: odds } }.
const raceIds = teams => new Set(teams.flatMap(t => (t.lineup?.starters || []).map(p => Number(p.proTeamId))));
function sinceKickoff({ teams, games, history, id, now }) {
  const ids = raceIds(teams);
  const kicks = games.filter(g => g.state === "in" && (g.teamIds || []).some(x => ids.has(Number(x)))).map(g => Date.parse(g.kickoff)).filter(Number.isFinite);
  return kicks.length ? rangeSince(history, id, Math.min(...kicks), now) : null;
}
// The day's first kickoff among the race's games that have started (New York's calendar day), or null.
const etDay = time => new Date(time).toLocaleDateString("en-US", { timeZone: "America/New_York" });
function dayStart(teams, games) {
  const ids = raceIds(teams), today = etDay(Date.now());
  const kicks = games.filter(g => g.state !== "pre" && (g.teamIds || []).some(x => ids.has(Number(x))) && etDay(Date.parse(g.kickoff)) === today)
    .map(g => Date.parse(g.kickoff)).filter(Number.isFinite);
  return kicks.length ? Math.min(...kicks) : null;
}
// The arcs outside the dial (Jim, 2026-11-08: where I started the day): the same range, but from the day's first
// kickoff and all day long, between slates and after the last game too; the text lines stay per slate.
function sinceDayStart({ teams, games, history, id, now }) {
  const t0 = dayStart(teams, games);
  return t0 == null ? null : rangeSince(history, id, t0, now);
}
function rangeSince(history, id, t0, now) {
  if (!history?.length) return null;
  const before = history.filter(x => Date.parse(x.t) <= t0 + 60000).at(-1);
  const vals = [before, ...history.filter(x => Date.parse(x.t) > t0 + 60000)].filter(Boolean).map(x => Number(x.p?.[id])).filter(Number.isFinite);
  if (!vals.length) return null;
  vals.push(Number(now));
  return { start: vals[0], min: Math.min(...vals), max: Math.max(...vals) };
}
// Drawn just outside the dial: a faint band over every odds the race has visited today, and an arrow
// from where it started to now. A short arrow in a wide band: it swung big and came back.
const R_ARC = R_OUT + 8;
const arcPath = (from, to, r = R_ARC) => {
  const [x1, y1] = point(from, r), [x2, y2] = point(to, r);
  return `M ${x1} ${y1} A ${r} ${r} 0 0 ${to > from ? 1 : 0} ${x2} ${y2}`;
};
function DriftArcs({ range, now, markerId }) {
  if (!range) return null;
  const moved = Math.abs(now - range.start) >= 1, wide = range.max - range.min >= 2;
  if (!moved && !wide) return null;
  return <>
    {wide ? <path d={arcPath(range.min, range.max)} className="needle-range" /> : null}
    {moved ? <>
      <defs><marker id={markerId} viewBox="0 0 6 6" refX="3" refY="3" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0 L6 3 L0 6 Z" className="needle-drift-head" /></marker></defs>
      <path d={arcPath(range.start, now)} className="needle-drift" markerEnd={`url(#${markerId})`} />
    </> : null}
    <circle cx={point(range.start, R_ARC)[0]} cy={point(range.start, R_ARC)[1]} r={2.5} className="needle-drift-start" />
  </>;
}

// Since halftime (Jim, 2026-11-02): the odds when the most recent halftime among this race's games in progress
// began (live runs stamp it on the game: halftimeAt), from the same history; null before any halftime.
function halftimeOdds({ a, b, history, games, twoWay }) {
  const ids = new Set([a, b].flatMap(t => (t.lineup?.starters || []).map(p => Number(p.proTeamId))));
  const halves = games.filter(g => g.state === "in" && g.halftimeAt && (g.teamIds || []).some(id => ids.has(Number(id)))).map(g => Date.parse(g.halftimeAt)).filter(Number.isFinite);
  if (!halves.length || !history?.length) return null;
  const at = history.filter(x => Date.parse(x.t) <= Math.max(...halves) + 60000).at(-1);
  const pa = Number(at?.p?.[a.teamId]), pb = Number(at?.p?.[b.teamId]);
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
// A center of gravity (Jim, 2026-11-02: too jittery live): the walk mostly hovers near the odds (40% of its
// reach) and now and then bursts out to the full range of futures, then settles back; a real move in the odds
// (a play, a drive) sets off a burst right away, so the big swings land with real events.
const CALM = 0.4, BURST_CHANCE = 0.025, BURST_DECAY = 0.88;
// fork ({ pOut } from injuryForks.js): two futures; the needle's center jumps between p (he's back) and pOut
// (he isn't) every few seconds, quaking around whichever it's on.
const FORK_SWITCH = 0.12;
// peeks (tdPeeks.js): odds if a player scores; each tick a peek starts with chance ∝ his TD chance and holds
// for about two seconds, so a likely scorer's TD is visited often and a long shot's now and then.
const PEEK_PER_TICK = 0.12, PEEK_TICKS = 6;
// Synced peeks (Jim, 2026-11-09: "needles should all dance together"): while a night game is the only game on,
// its peeks carry sync: true and one shared clock picks one outcome at a time ("🌙 big night from J. Jefferson",
// "🏈 if Jefferson scores"); every needle with that outcome visits it at once, so one team's jumps up while its
// opponent's drops. Same rates as a needle's own peeks.
// SYNC_REST: a breather between outcomes, so the needles settle back to the real odds in between.
const SYNC_REST = 4;
// SYNC_MIN_SWAY (Jim, 2026-11-12: "filtered by how much it'll sway one or more matchups"): an outcome comes up only
// if it moves some needle at least this many odds points. Then (Jim, 2026-11-12: "keep what ifs cycling through
// all players in play") the clock always picks one, taking turns by player (who) so everyone on the field comes up
// before anyone repeats, and picks among a player's outcomes by how likely each is on this drive.
// Low (2) when one game is on, with few players in it; with several games on, only the bigger swings (5; Jim,
// 2026-11-12: "lowering makes sense on a single game").
const SYNC_MIN_SWAY = 2, SYNC_MIN_SWAY_MANY = 5;
// Replays (the last play, Jim 2026-11-12): its needles sit at their odds before the play for REPLAY_PIN ticks, then
// swing to now while its text stays up REPLAY_TICKS in all. A new play goes first; it comes back now and then
// (REPLAY_AGAIN, as if that likely) while it's the last play, and needs no minimum sway, since it happened.
const REPLAY_PIN = 2, REPLAY_TICKS = 8, REPLAY_AGAIN = 0.25;
// label: the outcome the needles visit now (null: real odds); text, game, replay: what a one-spot display shows,
// which outlasts label for a replay; left: ticks the text has; pin: ticks the needles have.
const sync = { label: null, text: null, game: null, replay: false, left: 0, pin: 0, rest: 0, played: new Set(), turns: [], needles: new Set(), subs: new Set(), timer: null };
const notify = () => sync.subs.forEach(f => f(n => n + 1));
function syncTick() {
  if (sync.left > 0) {
    sync.left -= 1;
    if (sync.pin > 0 && !--sync.pin) { sync.label = null; notify(); }
    if (!sync.left) { sync.label = sync.text = sync.game = null; sync.replay = false; sync.rest = SYNC_REST; notify(); }
    return;
  }
  if (sync.rest > 0) { sync.rest -= 1; return; }
  const pool = new Map();
  // Keyed by pk.key (the event: a player's big game, a game's script) when there is one, else the label.
  // Each needle registers { peeks, p }; an outcome's sway is its biggest move on any needle, and its text the
  // label from a needle it names (not a silent echo).
  for (const ref of sync.needles) for (const pk of ref.current?.peeks || []) {
    if (!pk.sync) continue;
    const key = pk.key ?? pk.label, e = pool.get(key) || { chance: pk.chance, sway: 0, text: null, game: pk.game ?? null, replay: Boolean(pk.replay), who: pk.who ?? "" };
    e.sway = Math.max(e.sway, Math.abs(Number(pk.p) - Number(ref.current.p)) || 0);
    if (!pk.silent && !e.text) e.text = pk.label;
    e.echo = e.echo || pk.label;
    pool.set(key, e);
  }
  const start = (key, e) => {
    Object.assign(sync, { label: key, text: e.text || e.echo, game: e.game, replay: e.replay, left: e.replay ? REPLAY_TICKS : PEEK_TICKS, pin: e.replay ? REPLAY_PIN : PEEK_TICKS });
    if (e.replay) sync.played.add(key);
    notify();
  };
  const fresh = [...pool].find(([key, e]) => e.replay && !sync.played.has(key));
  if (fresh) return start(...fresh);
  // The last play comes back now and then; otherwise a what-if from whoever's turn it is.
  const replay = [...pool].find(([, e]) => e.replay);
  if (replay && Math.random() < REPLAY_AGAIN) return start(...replay);
  const games = new Set([...pool.values()].map(e => e.game).filter(Boolean));
  const minSway = games.size > 1 ? SYNC_MIN_SWAY_MANY : SYNC_MIN_SWAY;
  const all = [...pool].filter(([, e]) => !e.replay && e.sway >= minSway);
  if (!all.length) return;
  const whos = new Set(all.map(([, e]) => e.who));
  sync.turns = sync.turns.filter(w => whos.has(w));
  if (sync.turns.length >= whos.size) sync.turns = [];
  const due = all.filter(([, e]) => !sync.turns.includes(e.who));
  let r = Math.random() * due.reduce((sum, [, e]) => sum + (Number(e.chance) || 0.01), 0);
  const pick = due.find(([, e]) => (r -= Number(e.chance) || 0.01) <= 0) || due[due.length - 1];
  sync.turns.push(pick[1].who);
  start(...pick);
}
function useSyncedLabel(needleRef, on) {
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!on || reducedMotion()) return;
    sync.needles.add(needleRef); sync.subs.add(rerender);
    if (!sync.timer) sync.timer = setInterval(syncTick, 450);
    return () => {
      sync.needles.delete(needleRef); sync.subs.delete(rerender);
      if (!sync.subs.size) { clearInterval(sync.timer); sync.timer = null; sync.label = sync.text = sync.game = null; sync.left = sync.pin = 0; }
    };
  }, [on]);
  return on ? sync.label : null;
}
// The synced outcome, for a screen that shows it in one spot (Watch mode, Jim 2026-11-12) rather than under each
// needle: { text, game (its NFL game id, if known), replay (the last play) }, or null between outcomes.
export function useSyncedPeek() {
  const [, rerender] = useState(0);
  useEffect(() => {
    sync.subs.add(rerender);
    return () => { sync.subs.delete(rerender); };
  }, []);
  return sync.text ? { text: sync.text, game: sync.game, replay: sync.replay } : null;
}
function useQuake({ teams, games, history, historyId, p, fork = null, peeks = [] }) {
  const forked = useRef(false);
  const peeking = useRef(null), peekLeft = useRef(0);
  const peeksRef = useRef(peeks), needleRef = useRef(null);
  peeksRef.current = peeks;
  needleRef.current = { peeks, p };
  const syncLabel = useSyncedLabel(needleRef, peeks.some(x => x.sync));
  const { live, h } = lookAhead(stakesLeft(teams, games), wildness(history, historyId));
  const [wobble, setWobble] = useState(0);
  const burst = useRef(0), lastP = useRef(Number(p));
  if (Math.abs(Number(p) - lastP.current) >= 1) { burst.current = 1; lastP.current = Number(p); }
  useEffect(() => {
    if (!(h > 0) || reducedMotion()) { setWobble(0); return; }
    const RHO = live ? 0.8 : 0.88, gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    let w = gauss();
    const id = setInterval(() => {
      w = RHO * w + Math.sqrt(1 - RHO * RHO) * gauss();
      if (forkRef.current && Math.random() < FORK_SWITCH) forked.current = !forked.current;
      if (peekLeft.current > 0) peekLeft.current -= 1;
      else {
        peeking.current = null;
        // Night-game peeks (pregame, PrimetimeWatch.js nightPeeks) play before kickoff too. A random starting
        // point, so how often each comes up follows its chance, not its place in the list.
        const pks = peeksRef.current, start = Math.floor(Math.random() * pks.length);
        for (let k = 0; k < pks.length; k++) {
          const pk = pks[(start + k) % pks.length];
          if (!pk.sync && (live || pk.pregame) && Math.random() < PEEK_PER_TICK * pk.chance) { peeking.current = pk; peekLeft.current = PEEK_TICKS; break; }
        }
      }
      if (live && Math.random() < BURST_CHANCE) burst.current = 1;
      burst.current *= BURST_DECAY;
      setWobble(w * (CALM + (1 - CALM) * burst.current));
    }, live ? 300 : 650);
    return () => clearInterval(id);
  }, [live, h > 0]);
  const forkRef = useRef(fork);
  forkRef.current = fork;
  if (!fork) forked.current = false;
  const synced = syncLabel ? peeks.find(x => x.sync && !x.silent && (x.key ?? x.label) === syncLabel) || peeks.find(x => x.sync && (x.key ?? x.label) === syncLabel) || null : null;
  const peek = synced || (peeking.current && peeks.some(x => x.label === peeking.current.label) ? peeking.current : null);
  const pp = Math.min(99.9, Math.max(0.1, Number(peek ? peek.p : fork && forked.current ? fork.pOut : p)));
  const shown = h > 0 && wobble && Number.isFinite(pp) ? Math.min(99.5, Math.max(0.5, 100 * normalCdf((normalQuantile(pp / 100) + Math.sqrt(h) * wobble) / Math.sqrt(1 - h)))) : pp;
  return { live, shown: peek ? pp : shown, peek };
}

// One team's own needle (Jim, 2026-11-02: everyone within reach of the median line, every team in danger of the
// chop): its chance of the named outcome, on a small dial, moving by the same rules as the full needle.
// p: the chance of the right side's outcome; from: the same before the drives in progress moved it.
// sides: [left label, right label], colors: [left, right], or [left, middle, right] with band: [lo, hi] for a
// middle zone of its own (the median's yellow "near the line", 30-70%, as on the scoreboard). caption: the line under it (the team's name by
// default); stakes: the teams whose players can move it (the team itself, both sides of a matchup, or the whole
// league for the median line, which moves with every team).
// short: just the percentage (the Watch-mode tiles on a phone, whose header already names the teams);
// caption false: no line under it.
// fixed: always read the right side's chance, even under 50% (Jim, 2026-11-08: "30% ticket", not "70% no
// ticket"); otherwise the likelier side's.
export function MiniNeedle({ team, p, from = null, sides, colors, band = null, history = [], games = [], mine = false, caption = null, stakes = null, short = false, fork = null, peeks = [], fixed = false }) {
  const { live, shown, peek } = useQuake({ teams: stakes || [team], games, history, historyId: team.teamId, p, fork, peeks });
  const markerId = useId();
  if (!Number.isFinite(Number(p))) return null;
  const range = sinceDayStart({ teams: stakes || [team], games, history, id: team.teamId, now: Number(p) });
  const right = fixed || Number(p) >= 50;
  // With a middle color: red, yellow and green zones (stronger at the ends), and the odds colored by zone.
  const zones = colors.length === 3 && band
    ? [[0, 5, 0.9, colors[0]], [5, band[0], 0.55, colors[0]], [band[0], 50, 0.45, colors[1]], [50, band[1], 0.45, colors[1]], [band[1], 95, 0.55, colors[2]], [95, 100, 0.9, colors[2]]]
    : ZONES.map(([lo, hi, o]) => [lo, hi, o, hi <= 50 ? colors[0] : colors[colors.length - 1]]);
  const oddsColor = colors.length === 3 && band ? (p < band[0] ? colors[0] : p > band[1] ? colors[2] : colors[1]) : Number(p) >= 50 ? colors[colors.length - 1] : colors[0];
  // The drives' move in the number shown (the side it favors).
  const moved = from != null && Number.isFinite(Number(from)) ? (Number(p) - Number(from)) * (right ? 1 : -1) : 0;
  const deg = (shown / 100 - 0.5) * 180;
  return (
    <div className={"mini-needle" + (mine ? " mine" : "")} role="img" aria-label={`${team.team}: ${Math.round(p)}% ${sides[1]}`}
      title={`${team.team}: ${Math.round(p)}% ${sides[1]}, ${Math.round(100 - p)}% ${sides[0]}${live ? " · live" : ""}${fork ? ` · ${fork.label}: ${Math.round(p)}% ${sides[1]} if back, ${Math.round(fork.pOut)}% if not` : ""}`}>
      <svg viewBox="0 0 240 128" className="needle-dial">
        {zones.map(([lo, hi, o, c]) => <path key={lo} d={wedge(lo, hi)} fill={c} fillOpacity={o} />)}
        <line x1={CX} y1={CY - R_OUT - 3} x2={CX} y2={CY - R_IN + 3} className="needle-mid" />
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: `transform ${live ? 0.3 : 0.65}s ease-out` }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R_OUT - 4} className="needle-hand" />
        </g>
        <circle cx={CX} cy={CY} r={7} className="needle-hub" />
        <DriftArcs range={range} now={Math.min(99.9, Math.max(0.1, Number(p)))} markerId={markerId} />
      </svg>
      <b style={{ color: oddsColor }}>{Math.round(right ? p : 100 - p)}%{short ? "" : " " + (right ? sides[1] : sides[0])}
        {Math.abs(moved) >= 0.5 ? <small className={moved > 0 ? "up" : "down"}>{moved > 0 ? "▲" : "▼"}{Math.abs(Math.round(moved))}</small> : null}
        {live ? <span className="needle-live">●</span> : null}</b>
      {caption === false ? null : <span className="mini-needle-name">{caption || team.team}</span>}
      {peeks.length ? <span className="mini-needle-peek">{peek && !peek.silent ? `${peek.label}: ${Math.round(right ? peek.p : 100 - peek.p)}%` : "\u00a0"}</span> : null}
      {fork ? <span className="mini-needle-fork" title={`Flailing between two futures: ${Math.round(p)}% if he's back, ${Math.round(fork.pOut)}% if not`}>
        {fork.label} · {Math.round(right ? p : 100 - p)}↔{Math.round(right ? fork.pOut : 100 - fork.pOut)}%</span> : null}
    </div>
  );
}

export function Needle({ a, b, history = [], odds = null, label = null, games = [], fork = null, peeks = [] }) {
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
  const { live, shown, peek } = useQuake({ teams: [a, b], games, history, historyId: a.teamId, p: pB, fork, peeks });
  const arcId = useId();
  if (!Number.isFinite(pB)) return null;
  // The steady odds, and how far plays have moved them since the last full update.
  const moved = Number.isFinite(Number(fromB)) ? Number(oddsB) - Number(fromB) : 0;
  const arrow = d => Math.abs(d) >= 0.5 ? <small className={d > 0 ? "up" : "down"} title="Since the last full update, from the drives in progress">{d > 0 ? "▲" : "▼"}{Math.abs(Math.round(d))}</small> : null;
  const deg = (shown / 100 - 0.5) * 180;
  // Drift since kickoff: an arc outside the dial from the odds then to now, and the points it's moved.
  const twoWay = st => st == null ? null : { start: st, min: Math.min(st, pB), max: Math.max(st, pB) };
  const visited = !live ? null : odds ? twoWay(kickoffOdds({ a, b, history, games, twoWay: true }))
    : sinceKickoff({ teams: [a, b], games, history, id: b.teamId, now: pB });
  // The arcs: the whole day, from its first kickoff (the text line above stays per slate).
  const day = odds ? (() => { const at = dayStart([a, b], games); return at == null ? null : twoWay(kickoffOdds({ a, b, history, games, twoWay: true, at })); })()
    : sinceDayStart({ teams: [a, b], games, history, id: b.teamId, now: pB });
  const startB = visited ? visited.start : null;
  const drift = startB == null ? 0 : pB - startB;
  const field = live ? [onTheField(a, games), onTheField(b, games)] : null;
  const margin = da && db ? da.mean - db.mean : null;
  const lead = margin == null ? null : Math.abs(margin) < 0.25 ? "Dead even" : `${(margin > 0 ? a : b).team} by ${half(margin)}`;
  const lo = margin == null ? null : margin - 0.6745 * sd, hi = margin == null ? null : margin + 0.6745 * sd;
  // The middle half of outcomes, from the projected winner's side: "(likely by 3.5–17.5)", or, when it includes the
  // other team winning, "· could go either way" (Jim, 2026-11-09: "(either way)" wasn't clear).
  const sign = margin >= 0 ? 1 : -1;
  const range = lo == null ? null : lo * hi <= 0 ? " · could go either way" : ` (likely by ${half(Math.min(sign * lo, sign * hi))}–${half(Math.max(sign * lo, sign * hi))})`;
  return (
    <div className="needle" role="img" title={live ? "Live: the needle wanders over where the odds could be once the games in progress are over, averaging out at the current odds" : "Between games the needle only quakes; it swings while their players are in a game"} aria-label={`${label ? label + ": " : ""}${a.team} ${Math.round(100 - pB)}%, ${b.team} ${Math.round(pB)}%`}>
      {label || live ? <small className="needle-label">{label}{live ? <span className="needle-live">● LIVE</span> : null}</small> : null}
      <svg viewBox="0 0 240 128" className="needle-dial">
        {ZONES.map(([from, to, o]) => <path key={from} d={wedge(from, to)} fill={to <= 50 ? A_COLOR : B_COLOR} fillOpacity={o} />)}
        <line x1={CX} y1={CY - R_OUT - 3} x2={CX} y2={CY - R_IN + 3} className="needle-mid" />
        <g style={{ transform: `rotate(${deg}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: `transform ${live ? 0.3 : 0.65}s ease-out` }}>
          <line x1={CX} y1={CY} x2={CX} y2={CY - R_OUT - 4} className="needle-hand" />
        </g>
        <circle cx={CX} cy={CY} r={5} className="needle-hub" />
        <DriftArcs range={day} now={pB} markerId={arcId} />
      </svg>
      {Math.abs(drift) >= 1 ? <p className="needle-drift-text" title={`${b.team} ${Math.round(startB)}% when the game${games.filter(g => g.state === "in").length > 1 ? "s" : ""} kicked off, ${Math.round(pB)}% now`}>
        since kickoff {drift < 0 ? <b style={{ color: A_COLOR }}>◀ {Math.round(-drift)}</b> : <b style={{ color: B_COLOR }}>{Math.round(drift)} ▶</b>}</p> : null}
      {(() => {
        const half = live ? halftimeOdds({ a, b, history, games, twoWay: Boolean(odds) }) : null;
        const d = half == null ? 0 : pB - half;
        return half != null && Math.abs(d) >= 1 ? <p className="needle-drift-text" title={`${b.team} ${Math.round(half)}% at halftime, ${Math.round(pB)}% now`}>
          since halftime {d < 0 ? <b style={{ color: A_COLOR }}>◀ {Math.round(-d)}</b> : <b style={{ color: B_COLOR }}>{Math.round(d)} ▶</b>}</p> : null;
      })()}
      <div className="needle-odds">
        <span style={{ color: A_COLOR }}><b>{Math.round(100 - pB)}%{arrow(-moved)}</b>{a.team}</span>
        <span style={{ color: B_COLOR }}><b>{Math.round(pB)}%{arrow(moved)}</b>{b.team}</span>
      </div>
      {peeks.length ? <p className="needle-peek">{peek && !peek.silent ? <>{peek.label}: <b style={{ color: B_COLOR }}>{b.team} {Math.round(peek.p)}%</b></> : "\u00a0"}</p> : null}
      {fork ? <p className="needle-fork">{fork.label} · <b style={{ color: B_COLOR }}>{b.team} {Math.round(pB)}%</b> if he's back · <b style={{ color: B_COLOR }}>{Math.round(fork.pOut)}%</b> if not</p> : null}
      {field && (field[0].length || field[1].length) ? <div className="needle-field">
        {field.map((list, i) => <span key={i}>{list.map(p => <em key={p.name} className={p.trend} title={p.title}>{p.name} {p.trend === "up" ? "↑" : p.trend === "down" ? "↓" : "→"}</em>)}</span>)}
      </div> : null}
      {lead ? <p className="needle-line" title={`Projected ${money(da.mean)} – ${money(db.mean)}; middle half of outcomes: ${a.team} ${lo >= 0 ? "+" : "−"}${half(lo)} to ${hi >= 0 ? "+" : "−"}${half(hi)}`}>
        Projected: <b>{lead}</b>{range}</p> : null}
    </div>
  );
}

// A whole race at a glance (Jim, 2026-11-02): every team accounted for, in three tiers. Contenders (10-90%)
// get mini needles; the likely-but-not-settled ride in a chip row with their odds; the settled (99%+ or 1% or
// less, effectively locked) get a symbol. Teams move between tiers as they cross a line. Needles are ordered
// by odds as of the last full update (from), not the 15-second drive moves, so they don't hop around; your
// team comes first. items: [{ team, p, from }]; words: { likely: [left, right], locked: [left, right] };
// chipOdds "right" shows every chip's odds of the right side (the ticket's long shots), else each side's own.
export const LOCKED = 99;
// With max (the TV view, Jim 2026-11-02): only that many needles, the contenders with the most at stake
// (pick "stake": closest to 50%) or the best odds (pick "odds"), the rest in an "also in it" chip row. The set is
// sticky: a challenger takes a spot only once 5+ points better than the weakest shown, and onSwap hears of it
// ("Brock You Like a Hurricane in for Kyle Tucker") so the screen can call it out.
const SWAP_MARGIN = 5;
function useStickySet(items, max, score, onSwap) {
  const kept = useRef(null);
  const ids = i => String(i.team.teamId);
  let shown = items, swaps = [];
  if (max) {
    const byId = new Map(items.map(i => [ids(i), i]));
    shown = (kept.current || []).map(id => byId.get(id)).filter(Boolean);
    for (const i of [...items].sort((x, y) => score(y) - score(x))) if (shown.length < max && !shown.includes(i)) shown.push(i);
    for (const c of [...items].sort((x, y) => score(y) - score(x))) {
      if (shown.includes(c)) continue;
      const worst = [...shown].sort((x, y) => score(x) - score(y))[0];
      if (worst && score(c) >= score(worst) + SWAP_MARGIN) { swaps.push([c, worst]); shown = shown.map(i => i === worst ? c : i); }
    }
  }
  const key = shown.map(ids).join(",");
  useEffect(() => {
    const had = kept.current;
    kept.current = shown.map(ids);
    if (had && onSwap) for (const [c, out] of swaps) onSwap(c.team.team, out.team.team);
  }, [key]);
  return shown;
}

// Under the needles, two columns (Jim, 2026-11-02): the good outcomes on the left (✅ and likely), the bad on the
// right (❌ and likely the other way); good: which side is the good one ("right": above, the ticket; "left": safe).
export function NeedleRace({ label, items, sides, colors, band = null, words, chipOdds = "side", history = [], games = [], stakes = null, mine = null,
  max = null, pick = "odds", onSwap = null, good = "right", implied = null, compact = false, minShown = 0, fixed = false }) {
  // compact (Watch mode on a phone): each chip column runs on one line, ending in … ; a tap shows them in full.
  const [chipsOpen, setChipsOpen] = useState(false);
  const base = i => Number.isFinite(Number(i.from)) ? Number(i.from) : Number(i.p);
  const isMine = i => mine != null && Number(i.team.teamId) === Number(mine);
  const live = items.filter(i => Number.isFinite(Number(i.p)));
  const contenders = live.filter(i => i.p >= 10 && i.p <= 90);
  const shown = useStickySet(contenders, max, pick === "stake" ? i => -Math.abs(base(i) - 50) : base, onSwap);
  // minShown (the ticket's and chop's top two, Jim 2026-11-02): those keep their needles even outside 10-90%, pinned
  // near the end, rather than dropping into the chips; but not a 0% needle (3%+ only, Jim 2026-11-08).
  const filler = minShown ? live.filter(i => !shown.includes(i) && i.p >= 3).sort((x, y) => y.p - x.p).slice(0, Math.max(0, minShown - shown.length)) : [];
  const needles = [...shown, ...filler].sort((x, y) => isMine(y) - isMine(x) || base(y) - base(x));
  const alsoIn = contenders.filter(i => !shown.includes(i)).sort((x, y) => y.p - x.p);
  const chips = live.filter(i => !filler.includes(i));
  const likelyR = chips.filter(i => i.p > 90 && i.p < LOCKED).sort((x, y) => y.p - x.p);
  const likelyL = chips.filter(i => i.p > 100 - LOCKED && i.p < 10).sort((x, y) => x.p - y.p);
  const lockedR = chips.filter(i => i.p >= LOCKED), lockedL = chips.filter(i => i.p <= 100 - LOCKED);
  const name = i => <b key={i.team.teamId} className={isMine(i) ? "mine" : ""}>{i.team.team}</b>;
  const withOdds = (i, right) => <span key={i.team.teamId}>{name(i)} {Math.round(chipOdds === "right" || right ? i.p : 100 - i.p)}%</span>;
  const join = list => list.flatMap((x, k) => k ? [" · ", x] : [x]);
  // implied: the settled side that goes without saying (the ticket's ❌ out, the chop's ✅ safe: everyone not
  // listed), hidden on phones to save room (Jim, 2026-11-02).
  const tier = (text, list, hide = false) => list.length ? <p className={"race-tier" + (hide ? " implied" : "")}><small>{text}</small> {join(list)}</p> : null;
  if (!live.length) return null;
  return <>
    {label ? <small className="mini-needles-label">{label}</small> : null}
    {needles.length ? <div className="mini-needles">{needles.map(i => <MiniNeedle key={i.team.teamId} team={i.team} p={Number(i.p)} from={i.from} fork={i.fork || null} peeks={i.peeks || []}
      sides={sides} colors={colors} band={band} stakes={stakes} history={history} games={games} mine={isMine(i)} fixed={fixed} />)}</div> : null}
    <div className={"race-chips" + (compact ? " compact" : "") + (chipsOpen ? " open" : "")} onClick={compact ? () => setChipsOpen(o => !o) : undefined}>
    {/* Watch mode (compact) drops "also in it": the needles shown are the top contenders, the rest implied (Jim, 2026-11-12). */}
    {compact ? null : tier("also in it", alsoIn.map(i => withOdds(i, chipOdds === "right" || i.p >= 50)))}
    {(() => {
      // In Watch mode the implied side's likely tier goes too (the ticket's "long shots"; Jim, 2026-11-12).
      const right = [tier(words.locked[1], lockedR.map(name), implied === "right"), compact && implied === "right" ? null : tier(words.likely[1], likelyR.map(i => withOdds(i, true)))];
      const left = [tier(words.locked[0], lockedL.map(name), implied === "left"), compact && implied === "left" ? null : tier(words.likely[0], likelyL.map(i => withOdds(i, false)))];
      // A lone column runs full width rather than leaving a blank one beside it; one holding only the implied tier
      // (hidden on phones) is marked so a phone drops it too (Jim, 2026-11-12: "long shots" sat alone on the right).
      const col = (list, side) => ({ list, impliedOnly: implied === side && !list[1] });
      const cols = (good === "right" ? [col(right, "right"), col(left, "left")] : [col(left, "left"), col(right, "right")]).filter(c => c.list.some(Boolean));
      return cols.length ? <div className={"race-tiers" + (cols.length === 1 ? " one" : "")}>{cols.map((c, k) => <div key={k} className={c.impliedOnly ? "implied-only" : undefined}>{c.list}</div>)}</div> : null;
    })()}
    </div>
  </>;
}
