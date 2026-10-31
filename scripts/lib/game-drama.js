import { feedTeam } from "./survivor-model.js";

// 🔥 Drama index for this week's NFL games (Jim, 2026-10-31, after 538's bracket excitement index), shared by the
// Games tab and the League Wire's MUST-WATCH story. Each game gets 0-100 plus its top reasons.
// The league's NFL rooting interests (Jim): fans per team; the Rams' hometown fans count at a fair-weather discount.
export const LEAGUE_FANS = { LV: 1, KC: 2, SF: 3, LAR: 1.5, DET: 1 };
const FAN_NAMES = { LV: "Raiders", KC: "Chiefs", SF: "Niners", LAR: "Rams", DET: "Lions" };
const lev = p => 4 * p * (1 - p);   // 1 at a coin flip, 0 when decided
const clamp01 = x => Math.max(0, Math.min(1, x));

// Every league starter (main league and guillotine lineups) with its NFL game.
export function leagueStarters(games, scores, guillotineTeams) {
  const gameOfTeam = new Map(games.flatMap(g => (g.teams || []).map(t => [Number(t.id), g])));
  return [
    ...scores.flatMap(s => (s.lineup?.starters || []).map(p => ({ ...p, league: "main", teamId: Number(s.teamId), owner: s.team }))),
    ...guillotineTeams.flatMap(t => (t.lineup || []).map(p => ({ ...p, league: "g", teamId: Number(t.teamId), owner: t.team })))
  ].map(p => ({ ...p, game: gameOfTeam.get(Number(p.proTeamId)) })).filter(p => p.game);
}

// games: scoreboard.nflGames; scores: scoreboard.scores; guillotineTeams: this week's guillotine.teams (or []);
// svPicks: [{ user, team }] this week's revealed survivor picks; lineOf(game): the worker's /lines entry or null.
export function rateGames({ games, scores, guillotineTeams = [], svPicks = [], lineOf = () => null, starters = leagueStarters(games, scores, guillotineTeams) }) {
  // Pieces, each 0-1:
  // - close: a coin flip before kickoff (the betting line); live, how close it is weighted by how late it is
  // - upset: how far the pregame favorite has fallen
  // - fantasy: league starters' projections weighted by how undecided their matchups (or chop races) are, vs the week's biggest
  // - playoff: how much both NFL teams' playoff odds are still in play (FPI)
  // - survivor: survivor entries riding a side, weighted by its chance to lose
  // - breakout: a starter under 50% rostered beating his projection by 6+ points
  // - shootout: the over/under (pregame only)
  // - surprise: live, on pace to blow past the over/under (a game nobody circled turning wild)
  // - fans: the league's own rooting interests (LEAGUE_FANS)
  const scoreOf = new Map(scores.map(s => [Number(s.teamId), s]));
  const chopOf = new Map(guillotineTeams.map(t => [Number(t.teamId), Number(t.chopProbability) || 0]));
  const gameOfAbbrev = abbrev => games.find(g => (g.teams || []).some(t => feedTeam(t.abbrev) === abbrev));
  const rateGame = g => {
    const home = (g.teams || []).find(t => t.home), away = (g.teams || []).find(t => !t.home);
    if (!home || !away) return null;
    const line = lineOf(g), latest = line?.moves?.[line.moves.length - 1] || line?.open;
    const preHome = latest?.homeWin != null ? latest.homeWin / 100 : g.state === "pre" ? home.winChance : null;
    const inGame = starters.filter(p => p.game === g);
    let fantasyRaw = 0;
    for (const p of inGame) {
      const w = p.league === "main" ? lev((Number(scoreOf.get(p.teamId)?.winProbability) || 50) / 100) : lev((chopOf.get(p.teamId) || 0) / 100);
      fantasyRaw += (p.projection || 0) * w;
    }
    // The H2H matchup and the chop race this game could swing most: undecided (leverage) × the league
    // points riding on this game.
    const ptsBy = new Map();
    for (const x of inGame) { const k = x.league + x.teamId; const v = ptsBy.get(k) || { pts: 0, names: [] }; v.pts += x.projection || 0; v.names.push(x.name); ptsBy.set(k, v); }
    let h2h = null, chop = null;
    for (const sc of scores) {
      if (Number(sc.teamId) > Number(sc.opponentId)) continue;   // each matchup once
      const a = ptsBy.get("main" + Number(sc.teamId)), b = ptsBy.get("main" + Number(sc.opponentId));
      if (!a && !b) continue;
      const wp = (Number(sc.winProbability) || 50) / 100;
      const v = lev(wp) * clamp01(((a?.pts || 0) + (b?.pts || 0)) / 30);
      if (!h2h || v > h2h.v) h2h = { v, text: `Could swing ${sc.team} vs ${sc.opponent} (${Math.round(wp * 100)}–${Math.round((1 - wp) * 100)}): ${[...(a?.names || []), ...(b?.names || [])].slice(0, 3).join(", ")}` };
    }
    for (const t of guillotineTeams) {
      const mine = ptsBy.get("g" + Number(t.teamId)), c = (Number(t.chopProbability) || 0) / 100;
      if (!mine || c < 0.05) continue;
      const v = clamp01(lev(Math.min(c, 0.5)) * clamp01(mine.pts / 20) * 1.2);
      if (!chop || v > chop.v) chop = { v, text: `🪓 Could decide the chop: ${t.team} (${Math.round(c * 100)}% chop odds) has ${mine.names.slice(0, 2).join(", ")}` };
    }
    const riders = svPicks.filter(x => gameOfAbbrev(x.team) === g);
    const sideOf = abbrev => [home, away].find(t => feedTeam(t.abbrev) === abbrev);
    const svRisk = riders.reduce((a, x) => a + (g.completed ? 0 : 1 - (sideOf(x.team)?.winChance ?? 0.5)), 0) / Math.max(1, svPicks.length);
    const playoff = [home, away].reduce((a, t) => a + (t.playoffOdds == null ? 0 : lev(t.playoffOdds / 100)), 0) / 2;
    const progress = g.state === "in" ? clamp01(((Number(g.period) || 1) - 1 + (900 - (Number(g.clock) || 0)) / 900) / 4) : g.completed ? 1 : 0;
    const p = home.winChance ?? 0.5;
    const close = g.state === "pre" ? (preHome == null ? 0 : lev(preHome)) : g.completed ? 0 : lev(p) * (0.4 + 0.6 * progress);
    const favHome = preHome != null && preHome >= 0.5;
    const upset = preHome == null || g.state === "pre" ? 0 : clamp01((favHome ? preHome - (g.completed ? (home.score > away.score ? 1 : 0) : p) : (1 - preHome) - (g.completed ? (away.score > home.score ? 1 : 0) : 1 - p)) * 1.4);
    const boomer = inGame.filter(x => x.owned != null && x.owned < 50 && x.projection != null && x.actual - x.projection >= 6).sort((a, b) => (b.actual - b.projection) - (a.actual - a.projection))[0];
    const breakout = boomer ? clamp01((boomer.actual - boomer.projection) / 15) : 0;
    const shootout = latest?.total != null ? clamp01((latest.total - 38) / 16) : 0;
    const pace = progress >= 0.25 ? (home.score + away.score) / progress : null;
    const surprise = pace != null && latest?.total != null ? clamp01((pace - latest.total) / 20) : 0;
    const fanTeams = [away, home].filter(t => LEAGUE_FANS[t.abbrev]);
    const fans = clamp01(fanTeams.reduce((a, t) => a + LEAGUE_FANS[t.abbrev], 0) / 3);
    const fav = favHome ? home : away;
    return { g, home, away, spread: latest?.spread ?? null, total: latest?.total ?? null, fantasyRaw, playoff, svRisk, close, upset, breakout, shootout, surprise, fans, inGame, riders,
      why: [
        [h2h?.v || 0, h2h?.text || ""],
        [chop?.v || 0, chop?.text || ""],
        [close >= 0.85 ? close : 0, g.state === "pre" ? `Coin flip: ${Math.round((preHome ?? 0.5) * 100)}–${Math.round((1 - (preHome ?? 0.5)) * 100)}` : `Too close to call: ${Math.round(p * 100)}–${Math.round((1 - p) * 100)}`],
        [upset, `Upset ${g.completed ? "" : "brewing"}: ${fav.abbrev} was ${Math.round(Math.max(preHome ?? 0, 1 - (preHome ?? 0)) * 100)}% before kickoff`.replace("Upset :", "Upset:")],
        [svRisk * 3, `🛡️ ${riders.length} survivor ${riders.length === 1 ? "entry" : "entries"} riding ${[...new Set(riders.map(x => x.team))].join("/")}`],
        [breakout, boomer ? `Breakout: ${boomer.name} (${boomer.owned}% rostered) has ${boomer.actual.toFixed(2)}` : ""],
        [playoff * 0.8, `Playoff stakes: ${away.abbrev} ${Math.round(away.playoffOdds ?? 0)}%, ${home.abbrev} ${Math.round(home.playoffOdds ?? 0)}%`],
        [g.state === "pre" ? shootout * 0.6 : 0, `Shootout watch: O/U ${latest?.total}`],
        [surprise, `Off script: on pace for ${Math.round(pace ?? 0)} points, O/U was ${latest?.total}`],
        [fans * 0.7, `League rooting interest: ${fanTeams.map(t => `${FAN_NAMES[t.abbrev]} fans`).join(" vs ")}`]
      ] };
  };
  const rated = games.map(rateGame).filter(Boolean);
  const maxFantasy = Math.max(1, ...rated.map(r => r.fantasyRaw));
  for (const r of rated) {
    r.fantasy = r.fantasyRaw / maxFantasy;
    const sv = clamp01(r.svRisk * 3);
    r.drama = Math.round(100 * (r.g.state === "pre"
      ? 0.25 * r.close + 0.1 * r.shootout + 0.25 * r.fantasy + 0.15 * r.playoff + 0.15 * sv + 0.1 * r.fans
      : 0.2 * r.close + 0.15 * r.upset + 0.18 * r.fantasy + 0.08 * r.playoff + 0.12 * sv + 0.08 * r.breakout + 0.09 * r.surprise + 0.1 * r.fans));
    r.reasons = r.why.filter(([v, text]) => v >= 0.35 && text).sort((a, b) => b[0] - a[0]).map(([, text]) => text);
  }
  return rated;
}
