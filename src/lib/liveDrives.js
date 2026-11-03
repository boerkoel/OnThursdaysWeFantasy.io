import { useEffect, useMemo, useState } from "react";
import { gameScriptInputs, normalCdf, normalQuantile, playerOutlook } from "../../scripts/lib/simulation.js";

// Odds between live runs (Jim, 2026-11-02): each live run simulates the whole week (the cache). In between,
// the page reads ESPN's public scoreboard every 15 seconds and, as drives move (a first down, a sack, a
// punt), shifts each starter's remaining points by what the drive model says changed (simulation.js
// driveFactor), then re-reads the odds from the run's own distribution: win, median and ticket odds on the
// main league, chop odds in the guillotine. The next live run replaces it all with a fresh simulation.
// A game whose score has changed since the run is left alone: who got the points only arrives with the run.
const ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const POLL_MS = 15000;
const POSITION_IDS = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, "D/ST": 16 };
const z = p => normalQuantile(Math.min(0.9999, Math.max(0.0001, p / 100)));
const odds = (p, shift) => p <= 0 || p >= 100 || !shift ? p : Math.round(1000 * normalCdf(z(p) + shift)) / 10;

// ESPN's live games: id -> { state, period, clock, teams: [{ id, score, home }], drive }.
export function useEspnGames(active) {
  const [games, setGames] = useState(null);
  useEffect(() => {
    if (!active) { setGames(null); return; }
    let stopped = false;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await fetch(ESPN_SCOREBOARD, { cache: "no-store" });
        const data = r.ok ? await r.json() : null;
        if (!data || stopped) return;
        setGames(new Map((data.events || []).map(e => [String(e.id), { ...gameScriptInputs(e.competitions?.[0]), at: Date.now() }])));
      } catch {}
    };
    load();
    const id = setInterval(load, POLL_MS);
    const onVisible = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped = true; clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [active]);
  return games;
}

// A starter's change in remaining points between the run's game state and ESPN's now.
function restChange(p, base, fresh) {
  if (!base || !fresh || fresh.state !== "in" || base.state !== "in") return 0;
  const sameScore = (fresh.teams || []).every(t => (base.teams || []).find(b => Number(b.id) === Number(t.id))?.score === t.score);
  if (!sameScore) return 0;
  const pos = POSITION_IDS[p.pos], pro = Number(p.proTeamId);
  const rest = g => playerOutlook({ actual: p.actual, projection: p.projection, positionId: pos, game: g, proTeamId: pro, usage: p.usage }).rest;
  let change = rest(fresh) - rest(base);
  // His team had the ball and lost it without scoring: that drive's share of his points is gone.
  if (pos !== 16 && Number(base.drive?.possession) === pro && Number(fresh.drive?.possession) !== pro) {
    const secondsLeft = fresh.period > 4 ? 0 : (4 - (fresh.period || 1)) * 900 + (fresh.clock || 0);
    change -= rest({ ...fresh, drive: null }) / Math.max(4, 11 * secondsLeft / 3600);
  }
  return change;
}

// The run's games as ESPN has them now (for the drive, clock and score shown), plus each team's points change.
function teamChanges(teams, baseGames, espn) {
  const baseByPro = new Map(baseGames.flatMap(g => (g.teamIds || (g.teams || []).map(t => Number(t.id))).map(id => [Number(id), g])));
  const changes = new Map();
  for (const t of teams) {
    let sum = 0;
    for (const p of t.starters) {
      const base = baseByPro.get(Number(p.proTeamId));
      if (base) sum += restChange(p, base, espn.get(String(base.id)));
    }
    changes.set(t.id, sum);
  }
  return changes;
}

// The scoreboard with drive-adjusted odds and ESPN's current drives.
export function adjustScoreboard(scoreboard, espn) {
  const baseGames = scoreboard?.nflGames || [];
  if (!espn || !baseGames.length) return scoreboard;
  const scores = scoreboard.scores || [];
  const changes = teamChanges(scores.map(s => ({ id: s.teamId, starters: s.lineup?.starters || [] })), baseGames, espn);
  if (![...changes.values()].some(v => Math.abs(v) >= 0.05)) return { ...scoreboard, nflGames: mergeGames(baseGames, espn) };
  const byId = new Map(scores.map(s => [s.teamId, s]));
  const sds = scores.map(s => Number(s.projectionSd) || 0).sort((a, b) => a - b);
  const inPlay = sds.filter(v => v > 0.5), typical = inPlay[Math.floor(inPlay.length / 2)] || 0;   // teams still in play
  const adjusted = scores.map(s => {
    const mine = changes.get(s.teamId) || 0, opp = byId.get(s.opponentId), theirs = changes.get(s.opponentId) || 0;
    if (!mine && !theirs) return s;
    const sd = Number(s.projectionSd) || 0;
    const marginSd = Math.max(3, Math.hypot(sd, Number(opp?.projectionSd) || 0));
    const shift = d => d ? { ...d, ...Object.fromEntries(["mean", "p10", "p25", "p50", "p75", "p90"].filter(k => Number.isFinite(d[k])).map(k => [k, d[k] + mine])) } : d;
    return { ...s, liveShift: mine, liveWinFrom: s.winProbability, liveTopFrom: s.topScoreProbability, liveAboveFrom: s.aboveMedianProbability,
      projectionAverage: s.projectionAverage != null ? Number(s.projectionAverage) + mine : s.projectionAverage,
      projection: s.projection ? { ...s.projection, dist: shift(s.projection.dist) } : s.projection,
      winProbability: odds(Number(s.winProbability), (mine - theirs) / marginSd),
      aboveMedianProbability: odds(Number(s.aboveMedianProbability), mine / Math.max(3, Math.hypot(sd, 0.4 * typical))),
      topScoreProbability: odds(Number(s.topScoreProbability), mine / Math.max(3, Math.hypot(sd, typical))) };
  });
  return { ...scoreboard, scores: adjusted, nflGames: mergeGames(baseGames, espn) };
}

// The guillotine with drive-adjusted chop odds: each team against the others still at risk, renormalized.
export function adjustGuillotine(guillotine, baseGames, espn) {
  const teams = guillotine?.teams || [];
  if (!espn || !teams.length || !baseGames?.length) return guillotine;
  const changes = teamChanges(teams.map(t => ({ id: t.teamId, starters: t.lineup || [] })), baseGames, espn);
  const atRisk = teams.filter(t => t.chopProbability > 0 && t.chopProbability < 100);
  if (atRisk.length < 2 || !atRisk.some(t => Math.abs(changes.get(t.teamId) || 0) >= 0.05)) return guillotine;
  const raw = new Map(atRisk.map(t => {
    const others = atRisk.filter(o => o !== t), rel = (changes.get(t.teamId) || 0) - others.reduce((a, o) => a + (changes.get(o.teamId) || 0), 0) / others.length;
    return [t.teamId, odds(t.chopProbability, -rel / Math.max(3, Math.hypot(Number(t.projectionSd) || 0, Number(others[0].projectionSd) || 0)))];
  }));
  const total = [...raw.values()].reduce((a, b) => a + b, 0), share = atRisk.reduce((a, t) => a + t.chopProbability, 0);
  return { ...guillotine, teams: teams.map(t => raw.has(t.teamId)
    ? { ...t, liveChopFrom: t.chopProbability, chopProbability: Math.round(1000 * raw.get(t.teamId) * share / total) / 1000, projected: t.projected + (changes.get(t.teamId) || 0) } : t) };
}

// The run's games with ESPN's live clock, drive and score (only for games the run has, same week).
function mergeGames(baseGames, espn) {
  return baseGames.map(g => {
    const e = espn.get(String(g.id));
    if (!e || e.state === "pre") return g;
    return { ...g, state: e.state, completed: e.state === "post" || g.completed, period: e.period, clock: e.clock, drive: e.drive,
      teams: (g.teams || []).map(t => ({ ...t, score: e.teams.find(x => Number(x.id) === Number(t.id))?.score ?? t.score })) };
  });
}

// The live data with drive-adjusted odds, polling ESPN while any game is on.
export function useDriveAdjusted(live) {
  const games = live.scoreboard?.nflGames || [];
  const active = games.some(g => g.state === "in");
  const espn = useEspnGames(active);
  const adjusted = useMemo(() => espn ? {
    scoreboard: adjustScoreboard(live.scoreboard, espn),
    guillotine: adjustGuillotine(live.guillotine, live.scoreboard?.nflGames || [], espn)
  } : null, [live.scoreboard, live.guillotine, espn]);
  return adjusted ? { ...live, ...adjusted } : live;
}
